import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { CONVEX_URL } from "~/lib/config";
import { C } from "~/lib/theme";
import { TW_EXIT } from "~/lib/motion";
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

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: C.accent,
    background: C.bg,
    card: C.bg,
    text: C.w,
    border: C.border,
  },
};

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
  return (
    <GestureHandlerRootView style={styles.fill}>
      {/* Global reduced-motion policy (web MotionConfig reducedMotion="user"):
          animations default to the iOS setting; see lib/motion.ts. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <ConvexAuthProvider client={convex} storage={secureStorage}>
        <LocaleProvider>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <AuthGate />
          </ThemeProvider>
        </LocaleProvider>
      </ConvexAuthProvider>
    </GestureHandlerRootView>
  );
}

function AuthGate() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  // Hide the native splash as soon as the gate renders so the branded pulse
  // (the web's (app) layout loading state) is what shows while auth resolves.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View style={styles.fill}>
      {!isLoading && (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
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

const styles = StyleSheet.create({
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
});
