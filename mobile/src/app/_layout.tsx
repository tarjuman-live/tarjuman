import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, NativeModules, StyleSheet, TurboModuleRegistry, View } from "react-native";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  LayoutAnimationConfig,
  ReducedMotionConfig,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CONVEX_URL } from "~/lib/config";
import {
  C,
  registerThemeSwitcher,
  setThemeMode,
  themeJustSwitched,
  themed,
  useThemeMode,
  useThemeVersion,
  type ThemeMode,
} from "~/lib/theme";
import { EASE, TW_EXIT, useReduceMotion } from "~/lib/motion";
import { LocaleProvider, useT } from "~/i18n";
import { usePulse } from "~/components/motion/pulse";
import { ErrorScreen } from "~/components/error-screen";

SplashScreen.preventAutoHideAsync();
// Hand off from the native splash with a short fade rather than a cut.
SplashScreen.setOptions({ fade: true, duration: 200 });

// Same Convex deployment as the web app — sessions recorded on the phone show
// up on tarjuman.live and vice versa.
const convex = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });

// Auth tokens live in the iOS Keychain, not plain AsyncStorage.
const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

/** React Navigation's theme, rebuilt from the live palette on every switch. */
function navTheme(mode: ThemeMode) {
  const base = mode === "light" ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: C.accent,
      background: C.bg,
      card: C.bg,
      text: C.w,
      border: C.border,
    },
  };
}

/**
 * Root error boundary — mirrors src/app/(app)/error.tsx. Renders above the
 * providers below, so ErrorScreen's strings fall back to English.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("App error boundary caught:", error);
    void SplashScreen.hideAsync();
  }, [error]);
  return <ErrorScreen error={error} onRetry={() => void retry()} />;
}

export default function RootLayout() {
  "use no memo"; // outlives theme switches; must re-read the palette (React Compiler would cache it)
  // Re-render (navigation theme, status bar) on every theme switch.
  useThemeVersion();
  const mode = useThemeMode();
  return (
    <GestureHandlerRootView style={styles.fill}>
      {/* Global reduced-motion policy (web MotionConfig reducedMotion="user"):
          animations default to the iOS setting; see lib/motion.ts. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <ConvexAuthProvider client={convex} storage={secureStorage}>
        <LocaleProvider>
          <ThemeProvider value={navTheme(mode)}>
            <StatusBar style={mode === "light" ? "dark" : "light"} />
            <AuthGate />
            <ThemeCrossfade />
          </ThemeProvider>
        </LocaleProvider>
      </ConvexAuthProvider>
    </GestureHandlerRootView>
  );
}

/**
 * DEV-ONLY sign-in bypass (user request 2026-10-09). In a development build
 * with EXPO_PUBLIC_DEV_AUTH_BYPASS_SECRET in mobile/.env.local, a signed-out
 * launch signs straight in via the "dev-bypass" provider (convex/auth.ts),
 * which only the DEV deployment accepts. The `__DEV__ &&` guard lets release
 * builds drop the secret and this whole path. Once per launch, so signing out
 * to test the auth screens works until the next launch.
 */
const DEV_BYPASS_SECRET = __DEV__ ? process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS_SECRET : undefined;

/** Hidden screens repaint after the crossfade, while still out of sight. */
const HIDDEN_REMOUNT_DELAY_MS = 900;

/**
 * Wraps every root-stack screen. On a theme switch:
 *   - the focused screen remounts at once (under the crossfade's snapshot,
 *     so it is never seen half-built), mounting at rest — entrance
 *     animations skipped, scroll kept (useThemeScrollKeeper);
 *   - hidden screens (Record / History behind Settings) remount a beat
 *     later, out of sight — or the moment they regain focus — so the
 *     visible switch never waits on them.
 * A remount, not a re-render: the React Compiler caches each component's
 * output, so a plain re-render would leave cached subtrees in the old
 * colours. Navigation state is never touched.
 */
function ThemeRemount({
  navigation,
  children,
}: {
  navigation: { isFocused: () => boolean; addListener: (e: "focus", cb: () => void) => () => void };
  children: ReactNode;
}) {
  "use no memo"; // isFocused() / themeJustSwitched() are live reads the compiler must not cache
  const v = useThemeVersion();
  const [settled, setSettled] = useState(v);
  const focused = navigation.isFocused();
  // Focused: follow the version in this very render (one commit, no lag).
  const key = focused ? v : settled;
  useEffect(() => {
    if (settled === v) return;
    if (focused) {
      setSettled(v); // keep both in step so a later blur doesn't remount again
      return;
    }
    const id = setTimeout(() => setSettled(v), HIDDEN_REMOUNT_DELAY_MS);
    const off = navigation.addListener("focus", () => setSettled(v));
    return () => {
      clearTimeout(id);
      off();
    };
  }, [v, settled, focused, navigation]);
  return (
    <Fragment key={key}>
      <LayoutAnimationConfig skipEntering={themeJustSwitched()}>{children}</LayoutAnimationConfig>
    </Fragment>
  );
}

/** Budget for the snapshot (capture, then image load) before switching without it. */
const SNAPSHOT_TIMEOUT_MS = 400;
/** A press-in snapshot older than this is stale (the screen may have changed). */
const WARM_SHOT_MAX_AGE_MS = 1500;

type Capture = (opts: { format: "jpg"; quality: number; result: "tmpfile" }) => Promise<string>;
type Release = (uri: string) => void;

/**
 * react-native-view-shot, only when its native half is in this build: a JS
 * bundle newer than the installed app must fall back, not throw (the library
 * throws synchronously when RNViewShot is missing).
 */
function viewShot(): { capture: Capture; release: Release } | null {
  if (TurboModuleRegistry.get("RNViewShot") == null && NativeModules.RNViewShot == null) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("react-native-view-shot") as { captureScreen: Capture; releaseCapture: Release };
    return { capture: m.captureScreen, release: m.releaseCapture };
  } catch {
    return null;
  }
}

/**
 * The switch transition — a true crossfade, never a blank frame (user
 * direction 2026-10-12):
 *   1. snapshot the screen as it is (old colours) and lay it on top, fully
 *      opaque — it looks exactly like the screen, so nothing visibly changes;
 *   2. flip the palette underneath (Settings repaints in place);
 *   3. fade the snapshot out (280ms CSS ease) → the old look dissolves into
 *      the new one.
 * Reduce Motion, or no snapshot module (stale native build): instant switch.
 */
function ThemeCrossfade() {
  "use no memo"; // drives the switch itself; keep it uncompiled like its neighbours
  const reduce = useReduceMotion();
  const o = useSharedValue(0);
  const [shot, setShot] = useState<string | null>(null);
  const pending = useRef<ThemeMode | null>(null);
  // Refs, not state, for everything flip()/finish() read: they also run from
  // timers created in an earlier render.
  const shotRef = useRef<string | null>(null);
  const busy = useRef(false);

  // A snapshot taken on press-IN (finger down), so a tap's ~150ms of capture
  // overlaps the touch itself instead of delaying the switch.
  const warm = useRef<{ at: number; shot: Promise<string> } | null>(null);
  const releaseWarm = () => {
    const w = warm.current;
    warm.current = null;
    void w?.shot.then((uri) => viewShot()?.release(uri)).catch(() => {});
  };

  useEffect(
    () =>
      registerThemeSwitcher(
        (next) => {
        const vs = reduce || busy.current ? null : viewShot();
        if (!vs) {
          releaseWarm();
          setThemeMode(next);
          return;
        }
        busy.current = true;
        // Never let the switch hang on the snapshot: if it hasn't produced an
        // image in time (or the native call never answers), switch instantly.
        let settled = false;
        const giveUp = () => {
          if (settled) return;
          settled = true;
          busy.current = false;
          setThemeMode(next);
        };
        const timer = setTimeout(giveUp, SNAPSHOT_TIMEOUT_MS);
        let shotPromise: Promise<string>;
        try {
          const w = warm.current;
          warm.current = null;
          shotPromise =
            w && Date.now() - w.at < WARM_SHOT_MAX_AGE_MS
              ? w.shot
              : vs.capture({ format: "jpg", quality: 0.95, result: "tmpfile" });
        } catch {
          clearTimeout(timer);
          giveUp();
          return;
        }
        shotPromise
          .then((uri) => {
            if (settled) {
              vs.release(uri);
              return;
            }
            settled = true;
            clearTimeout(timer);
            pending.current = next;
            shotRef.current = uri;
            o.value = 1;
            setShot(uri); // → onLoad below flips the palette
            // …and if the image never loads, flip anyway.
            setTimeout(() => {
              if (pending.current === next) flip();
            }, SNAPSHOT_TIMEOUT_MS);
          })
          .catch(() => {
            clearTimeout(timer);
            giveUp();
          });
        },
        () => {
          // Press-in on a theme option: pre-capture.
          if (reduce || busy.current) return;
          const vs = viewShot();
          if (!vs) return;
          releaseWarm();
          try {
            const shot = vs.capture({ format: "jpg", quality: 0.95, result: "tmpfile" });
            shot.catch(() => {});
            warm.current = { at: Date.now(), shot };
            // A press that never becomes a switch: drop the file.
            setTimeout(() => {
              if (warm.current?.shot === shot) releaseWarm();
            }, WARM_SHOT_MAX_AGE_MS);
          } catch {
            warm.current = null;
          }
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduce, o],
  );

  const finish = (uri: string) => {
    shotRef.current = null;
    setShot(null);
    busy.current = false;
    viewShot()?.release(uri);
  };

  const onLoad = () => flip();

  // Shared by onLoad / onError / the load timeout: switch under the snapshot.
  const flip = () => {
    const next = pending.current;
    const uri = shotRef.current;
    pending.current = null;
    if (!next) return;
    if (!uri) {
      busy.current = false;
      setThemeMode(next);
      return;
    }
    // One frame for the snapshot to be on screen, then flip underneath it;
    // two more for the re-render to commit and paint, then dissolve.
    requestAnimationFrame(() => {
      setThemeMode(next);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          o.value = withTiming(0, { duration: 280, easing: EASE.css, reduceMotion: ReduceMotion.Never }, (done) => {
            if (done) scheduleOnRN(finish, uri);
          });
        }),
      );
    });
  };

  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  if (!shot) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Image
        source={{ uri: shot }}
        onLoad={onLoad}
        onError={flip}
        fadeDuration={0}
        resizeMode="stretch"
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function AuthGate() {
  "use no memo"; // screen options read the live palette (see RootLayout)
  // Header options (tint) read the palette at render → follow switches.
  useThemeVersion();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const triedBypass = useRef(false);
  const [bypassing, setBypassing] = useState(false);
  useEffect(() => {
    if (!DEV_BYPASS_SECRET || authLoading || isAuthenticated || triedBypass.current) return;
    triedBypass.current = true;
    setBypassing(true);
    void signIn("dev-bypass", { secret: DEV_BYPASS_SECRET })
      .catch(() => {})
      .finally(() => setBypassing(false));
  }, [authLoading, isAuthenticated, signIn]);
  // Hold the branded loading tile while the bypass runs, so Welcome never
  // flashes before the signed-in app.
  const isLoading = authLoading || bypassing;

  // Hide the native splash as soon as the gate renders so the branded pulse
  // (the web's (app) layout loading state) is what shows while auth resolves.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View style={styles.fill}>
      {!isLoading && (
        <Stack
          screenLayout={({ navigation, children }) => (
            <ThemeRemount navigation={navigation}>
              {children}
            </ThemeRemount>
          )}
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}
        >
          <Stack.Protected guard={isAuthenticated}>
            <Stack.Screen name="(tabs)" />
            {/* Settings is reached from the profile popup (AccountMenu), like the
                web's account menu — it is not a tab (the web's phone nav is
                Record + History only). Its own header carries the back button. */}
            <Stack.Screen name="settings" />
            <Stack.Screen
              name="session/[id]"
              options={{
                headerShown: true,
                headerTitle: "",
                headerBackButtonDisplayMode: "minimal",
                headerTransparent: true,
                headerTintColor: C.w,
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!isAuthenticated}>
            {/* Welcome (the landing) is the signed-out entry point. */}
            <Stack.Screen name="welcome" />
            {/* The web's auth popup: presented over Welcome, overlay fade
                150ms in AND out (tw-animate default). The screen paints its
                own backdrop + glass card and owns the card's zoom-95. */}
            <Stack.Screen
              name="sign-in"
              options={{
                presentation: "transparentModal",
                // sign-in.tsx runs the web's own 150ms overlay fade + card
                // zoom-95, in AND out. A native modal fade here would stack
                // UIKit's fixed ~0.3s cross-dissolve on top of it.
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen name="forgot-password" />
          </Stack.Protected>
        </Stack>
      )}
      {isLoading && <AuthLoading />}
    </View>
  );
}

/**
 * Branded gate while Convex Auth resolves — (app)/layout.tsx: a 48px accent
 * mic tile with a 0 0 30px accent@40 glow, `animate-pulse` (2s). Fades out
 * (150ms) over the first screen instead of cutting.
 */
function AuthLoading() {
  const t = useT();
  const pulse = usePulse();
  return (
    <Animated.View
      exiting={TW_EXIT.fade}
      style={[StyleSheet.absoluteFill, styles.gate]}
      accessibilityLabel={t("foundation.loading")}
      accessibilityRole="progressbar"
    >
      <Animated.View style={[styles.tile, pulse]}>
        <SymbolView name="mic.fill" size={22} tintColor="#0A0F1C" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  gate: { backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: `0 0 30px ${C.accent}40`,
  },
}));
