/**
 * AccountCard — the "Account" card of src/app/(app)/settings/page.tsx
 * (lines 212-300), plus the small shared settings-row primitives.
 *
 * Motion (web → native):
 *   - Avatar button `transition-transform active:scale-95` → press scale .95,
 *     150ms Tailwind curve (not gated by reduced motion — plain CSS).
 *   - Edit overlay (rgba(0,0,0,.45) + pencil) `transition-opacity`
 *     `opacity-0 group-hover:opacity-100` → fades 0 → 1 while PRESSED (hover →
 *     press), 150ms Tailwind curve; forced to 1 while a photo uploads.
 *   - Upload spinner: 16px `border-2 animate-spin` ring, white on three sides
 *     with the right side transparent, 1s linear infinite.
 *   - Display-name row `hover:bg-black/10 transition-colors` → PressRow: a
 *     black overlay fades 0 → .1 while pressed, 150ms Tailwind curve.
 *
 * Profile picture: the upload pipeline (generateUploadUrl → POST bytes →
 * setProfileImage, 5 MB / image-only guards, inline error) is the web's,
 * verbatim, and it runs IN PLACE, with the spinner and the held overlay, the
 * way the web's hidden <input type=file> does. The picker is the built-in
 * `libraryPicker`: it loads expo-image-picker as an OPTIONAL dependency (a
 * require inside try/catch; @expo/metro-config sets allowOptionalDependencies).
 * PACKAGE NEEDED: `bunx expo install expo-image-picker`, then prebuild. Until
 * that native module is in the binary, the avatar falls back to opening the
 * web Settings page. A caller may still inject its own `pickImage`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { C } from "~/lib/theme";
import { API_URL } from "~/lib/config";
import { EASE, SPIN, useReduceMotion } from "~/lib/motion";
import { rtlRow, rtlText, useLocale } from "~/i18n";
import { PressableScale } from "./motion/pressable-scale";
import { AnchoredPopover } from "./motion/popover";
import { usePulse } from "./motion/pulse";
import { GLASS } from "./glass";
import { useHiddenByRail } from "./locale-switcher";

/** Tailwind default `transition-*` — 150ms bezier(.4,0,.2,1), never gated. */
const TW_T = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

// ─── FadeGlass ───────────────────────────────────────────────────────────────

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/** Outer-view style to pair with <FadeGlass>: keeps the 1px border's layout
 *  slot but draws nothing (the frame layer paints the border + shadow). */
export const FADE_GLASS_FRAME: ViewStyle = { borderWidth: 1, borderColor: "transparent" };

/**
 * GlassBackground whose fade is driven WITHOUT alpha on a UIVisualEffectView
 * ancestor. UIKit drops or garbles a blur whose ancestor has alpha < 1, so a
 * glass surface that fades (dialog card, bottom-nav hide, auth card) must not
 * fade its container's `opacity`. Instead, off one 0→1 `progress`:
 *   - the BlurView's `intensity` ramps 0 → `intensity` (animated prop),
 *   - the tint, the inset catch-light/shade and the frame (1px border + drop
 *     shadow) fade their own opacity,
 * which matches the web, where backdrop-filter fades together with opacity.
 *
 * Put it first inside a container styled with FADE_GLASS_FRAME (NOT
 * GLASS.card, and NO opacity on the container), and fade the content in a
 * separate wrapper. Built here because the foundation GlassBackground only
 * takes a static intensity.
 */
export function FadeGlass({
  progress,
  radius = 24,
  intensity = 60,
  shadow = GLASS.shadow,
  borderColor = GLASS.border,
}: {
  progress: SharedValue<number>;
  radius?: number;
  intensity?: number;
  shadow?: string;
  borderColor?: string;
}) {
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const blur = useAnimatedProps(() => ({ intensity: intensity * Math.max(0, Math.min(1, progress.value)) }));
  return (
    <>
      {/* Frame: sits over the container's transparent 1px border slot. */}
      <Animated.View
        pointerEvents="none"
        style={[fgStyles.frame, { borderRadius: radius, borderColor, boxShadow: shadow }, fade]}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
        <AnimatedBlurView tint="dark" animatedProps={blur} style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: GLASS.tint }, fade]} />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)",
            },
            fade,
          ]}
        />
      </View>
    </>
  );
}

const fgStyles = StyleSheet.create({
  frame: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderWidth: 1 },
});

// ─── PressRow ────────────────────────────────────────────────────────────────

/**
 * A full-width tappable row whose `hover:bg-black/N transition-colors` maps to
 * a pressed overlay (black at `dim`, default .1 → settings rows; .2 → the
 * account-menu items), 150ms Tailwind curve. Put bg/border/radius in `style`.
 */
export function PressRow({
  children,
  onPress,
  disabled,
  dim = 0.1,
  style,
  disabledOpacity,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  dim?: number;
  style?: StyleProp<ViewStyle>;
  /** `disabled:opacity-50` rows pass .5 (instant, like the web class). */
  disabledOpacity?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link";
}) {
  const p = useSharedValue(0);
  const overlay = useAnimatedStyle(() => ({ opacity: p.value * dim }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        p.value = withTiming(1, TW_T);
      }}
      onPressOut={() => {
        p.value = withTiming(0, TW_T);
      }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.pressRow, style, disabled && disabledOpacity !== undefined && { opacity: disabledOpacity }]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlayBlack, overlay]} />
      {children}
    </Pressable>
  );
}

// ─── PlanBadge ───────────────────────────────────────────────────────────────

/** components/billing/plan-badge.tsx — renders nothing for free / loading. */
const TIER: Record<string, { label: string; color: string; soft: string }> = {
  pro: { label: "Pro", color: C.accent, soft: C.accentSoft },
  scholar: { label: "Scholar", color: C.amber, soft: C.amberSoft },
};

export function PlanBadge() {
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth, {});
  const meta = usage ? TIER[usage.plan] : undefined;
  if (!meta) return null;
  return (
    <View style={[styles.badge, { backgroundColor: meta.soft }]}>
      <Text style={[styles.badgeText, { color: meta.color }]}>✦ {meta.label}</Text>
    </View>
  );
}

// ─── Upload ring (animate-spin) ─────────────────────────────────────────────

function UploadRing() {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = 0;
    r.value = withRepeat(
      withTiming(360, { duration: SPIN.periodMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
      undefined,
      ReduceMotion.Never
    );
    return () => cancelAnimation(r);
  }, [r]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View accessibilityRole="progressbar" style={[styles.ring, spin]} />;
}

// ─── AccountCard ─────────────────────────────────────────────────────────────

export interface PickedImage {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
}

export interface AccountCardProps {
  me: { name?: string | null; email?: string | null; image?: string | null };
  onEditName: () => void;
  /** Override the built-in library picker. With neither, the avatar opens web Settings. */
  pickImage?: () => Promise<PickedImage | null>;
}

// ─── Built-in photo-library picker (optional expo-image-picker) ─────────────

interface ImagePickerLike {
  requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  launchImageLibraryAsync(options: {
    mediaTypes?: string[];
    quality?: number;
    allowsMultipleSelection?: boolean;
  }): Promise<{
    canceled: boolean;
    assets?: { uri: string; mimeType?: string | null; fileSize?: number | null }[] | null;
  }>;
}

/** expo-image-picker if installed AND its native module is linked; else null. */
const IMAGE_PICKER: ImagePickerLike | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-image-picker") as Partial<ImagePickerLike> | undefined;
    return mod && typeof mod.launchImageLibraryAsync === "function" ? (mod as ImagePickerLike) : null;
  } catch {
    return null;
  }
})();

/** web `<input type="file" accept="image/*">` → the iOS photo library (images only). */
const libraryPicker: (() => Promise<PickedImage | null>) | undefined = IMAGE_PICKER
  ? async () => {
      const perm = await IMAGE_PICKER.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return null;
      const res = await IMAGE_PICKER.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      const a = res.canceled ? undefined : res.assets?.[0];
      return a ? { uri: a.uri, mimeType: a.mimeType ?? null, fileSize: a.fileSize ?? null } : null;
    }
  : undefined;

export function AccountCard({ me, onEditName, pickImage = libraryPicker }: AccountCardProps) {
  const { t, dir } = useLocale();
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const setProfileImage = useMutation(api.users.setProfileImage);
  const [uploading, setUploading] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Edit overlay: 0 at rest, 1 while pressed or uploading.
  const overlay = useSharedValue(0);
  useEffect(() => {
    overlay.value = withTiming(uploading ? 1 : 0, TW_T);
  }, [uploading, overlay]);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));

  // A new picture URL deserves a fresh load attempt.
  useEffect(() => {
    setImageBroken(false);
  }, [me.image]);

  const initial = (me.name?.[0] ?? me.email?.[0] ?? "?").toUpperCase();
  const showImage = Boolean(me.image) && !imageBroken;

  const onAvatar = async () => {
    if (!pickImage) {
      void WebBrowser.openBrowserAsync(`${API_URL}/settings`).catch(() => {});
      return;
    }
    let file: PickedImage | null;
    try {
      file = await pickImage();
    } catch {
      setImageError(t("settingsAuthNav.imageUpdateFailed"));
      return;
    }
    if (!file) return;
    const mime = file.mimeType ?? "image/jpeg";
    if (!mime.startsWith("image/")) {
      setImageError(t("settingsAuthNav.imageNotImage"));
      return;
    }
    if (file.fileSize != null && file.fileSize > 5 * 1024 * 1024) {
      setImageError(t("settingsAuthNav.imageTooBig"));
      return;
    }
    setUploading(true);
    setImageError(null);
    setImageBroken(false);
    try {
      const uploadUrl = await generateUploadUrl();
      const blob = await (await fetch(file.uri)).blob();
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: blob });
      if (!res.ok) throw new Error(t("settingsAuthNav.imageUploadFailed"));
      const { storageId } = (await res.json()) as { storageId: string };
      await setProfileImage({ storageId: storageId as Id<"_storage"> });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : t("settingsAuthNav.imageUpdateFailed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={[styles.head, rtlRow(dir)]}>
        <PressableScale
          onPress={() => void onAvatar()}
          disabled={uploading}
          disabledOpacity={1}
          scaleTo={0.95}
          onPressIn={() => {
            overlay.value = withTiming(1, TW_T);
          }}
          onPressOut={() => {
            if (!uploading) overlay.value = withTiming(0, TW_T);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("settingsAuthNav.changePicture")}
          accessibilityState={{ busy: uploading }}
          style={styles.avatar}
        >
          <View style={styles.avatarClip}>
            {showImage ? (
              <Image
                source={{ uri: me.image! }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                onError={() => setImageBroken(true)}
              />
            ) : (
              <Text style={styles.initial}>{initial}</Text>
            )}
            <Animated.View pointerEvents="none" style={[styles.avatarOverlay, overlayStyle]}>
              {uploading ? <UploadRing /> : <SymbolView name="pencil" size={15} tintColor={C.w} />}
            </Animated.View>
          </View>
        </PressableScale>
        <View style={styles.identity}>
          <View style={[styles.nameRow, rtlRow(dir)]}>
            <Text style={[styles.name, rtlText(dir)]} numberOfLines={1}>
              {me.name ?? t("settingsAuthNav.yourAccount")}
            </Text>
            <PlanBadge />
          </View>
          <Text style={[styles.email, rtlText(dir)]} numberOfLines={1}>
            {me.email ?? "—"}
          </Text>
          {imageError ? <Text style={[styles.imageError, rtlText(dir)]}>{imageError}</Text> : null}
        </View>
      </View>
      <View style={styles.divider} />
      <PressRow onPress={onEditName} style={[styles.nameEdit, rtlRow(dir)]} accessibilityLabel={t("settings.displayName")}>
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.rowTitle, rtlText(dir)]}>{t("settings.displayName")}</Text>
          <Text style={[styles.rowSub, rtlText(dir)]}>{me.name ?? t("settings.addName")}</Text>
        </View>
        <SymbolView name="pencil" size={16} tintColor={C.t3} />
      </PressRow>
    </View>
  );
}


// ─── AccountMenu (web components/auth/account-menu.tsx) ─────────────────────

/** `border-color 200ms ease, box-shadow 200ms ease` + the menu's duration-200. */
const MENU_T = { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never };
const MENU_LIT_SHADOW = "0 0 0 1px #2ECC71, 0 0 16px rgba(46,204,113,0.45)";

/**
 * The 36×36 avatar tile + its Settings / Sign out menu. `dropUp` is the
 * sidebar-rail footer variant (web sidebar.tsx `<AccountMenu dropUp />`).
 *
 * Motion (web → native):
 *   - Trigger lit (hover || open → pressed || open): border accent@40 →
 *     accent and box-shadow → `0 0 0 1px accent, 0 0 16px accent@45`, 200ms
 *     CSS ease. The glow layer sits on the tile's BORDER box (the tile's
 *     border is drawn by an inner absolute-fill view, so the Pressable's
 *     absolute-fill = the border box), so the 1px spread ring lands OUTSIDE
 *     the 1px accent border — a 2px lit outline, like the web — instead of on
 *     top of it (which PressableScale's padding-box glow layer would do).
 *   - `active:scale-95` (transform 150ms ease).
 *   - `animate-pulse` on the whole tile while `me` loads.
 *   - Panel (w-56, keep-mounted 200ms): drop-down = `origin-top-right fade-in
 *     zoom-in-95 slide-in-from-top-1`; dropUp = `left-0 bottom-full mb-2
 *     origin-bottom-left … slide-in-from-bottom-1`; and the mirrored
 *     `animate-out fade-out zoom-out-95 slide-out-to-…-1` on close. 200ms CSS
 *     ease, IN and OUT. AnchoredPopover supplies fade + 4px slide; the zoom
 *     (.95 ↔ 1 from the trigger corner) is layered on the card here.
 *   - Reduce Motion: tw-animate classes are NOT motion-gated on the web, so
 *     the zoom + slide still play. AnchoredPopover drops its slide under
 *     reduce, so the card re-adds the same ∓4 → 0 slide in that case.
 *   - Menu items `hover:bg-black/20 transition-colors` → PressRow dim .2.
 *
 * RTL UI (drop-down only): the header row reverses, putting the avatar at the
 * far left, so the menu anchors to its LEFT edge and grows from top-left.
 */
export function AccountMenu(props: { dropUp?: boolean } = {}) {
  // Web hides the record header's AccountMenu at lg; the rail footer's stays.
  if (useHiddenByRail()) return null;
  return <AccountMenuImpl {...props} />;
}

function AccountMenuImpl({ dropUp = false }: { dropUp?: boolean } = {}) {
  const { t, dir } = useLocale();
  const rtl = dir === "rtl";
  const router = useRouter();
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const reduce = useReduceMotion();
  const [open, setOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const trigger = useRef<View>(null);
  const loading = me === undefined;
  const pulse = usePulse(loading);
  const showImage = Boolean(me?.image) && !imageBroken;
  const initial = (me?.name?.[0] ?? me?.email?.[0] ?? "?").toUpperCase();

  useEffect(() => {
    setImageBroken(false);
  }, [me?.image]);

  // Trigger lit = pressed || open. Both are React state so the release
  // (pressOut) and the toggle (press) batch into ONE target — no dip to 0
  // between letting go and the menu opening.
  const [pressing, setPressing] = useState(false);
  const lit = useSharedValue(0);
  useEffect(() => {
    lit.value = withTiming(open || pressing ? 1 : 0, MENU_T);
  }, [open, pressing, lit]);
  const tileBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(lit.value, [0, 1], [`${C.accent}40`, C.accent]) as string,
  }));
  const glow = useAnimatedStyle(() => ({ opacity: lit.value }));

  // Card zoom: 0 = closed pose (.95), 1 = open. Not reduce-gated (web isn't).
  const p = useSharedValue(0);
  useEffect(() => {
    if (open) {
      p.value = 0;
      p.value = withTiming(1, MENU_T);
    } else {
      p.value = withTiming(0, MENU_T);
    }
  }, [open, p]);
  const slideFrom = dropUp ? 4 : -4;
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      // AnchoredPopover supplies the slide unless Reduce Motion is on.
      { translateY: reduce ? slideFrom * (1 - p.value) : 0 },
      { scale: 0.95 + 0.05 * p.value },
    ],
  }));

  const origin = dropUp ? "bottom left" : rtl ? "top left" : "top right";
  const placement = dropUp ? "top-start" : rtl ? "bottom-start" : "bottom-end";

  return (
    <>
      <Animated.View style={pulse}>
        <PressableScale
          ref={trigger}
          onPress={() => setOpen((o) => !o)}
          onPressIn={() => setPressing(true)}
          onPressOut={() => setPressing(false)}
          scaleTo={0.95}
          easing={EASE.css}
          accessibilityRole="button"
          accessibilityLabel={t("settingsAuthNav.accountMenu")}
          accessibilityState={{ busy: loading, expanded: open }}
          style={styles.menuTrigger}
        >
          <Animated.View pointerEvents="none" style={[styles.menuTriggerGlow, glow]} />
          <Animated.View
            style={[
              styles.menuTile,
              { backgroundColor: showImage ? "transparent" : C.accentSoft },
              tileBorder,
            ]}
          >
            <View style={styles.menuTileClip}>
              {showImage ? (
                <Image
                  source={{ uri: me!.image! }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  onError={() => setImageBroken(true)}
                />
              ) : loading ? null : (
                <Text style={styles.menuInitial}>{initial}</Text>
              )}
            </View>
          </Animated.View>
        </PressableScale>
      </Animated.View>

      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        placement={placement}
        gap={dropUp ? 8 : 4}
        width={224}
        style={styles.menuPanel}
      >
        <Animated.View style={[styles.menuCard, { transformOrigin: origin }, zoomStyle]}>
          <View style={styles.menuClip}>
            <View style={styles.menuHead}>
              <View style={[styles.menuNameRow, rtlRow(dir)]}>
                {me?.name ? (
                  <Text style={[styles.menuName, rtlText(dir)]} numberOfLines={1}>
                    {me.name}
                  </Text>
                ) : null}
                <PlanBadge />
              </View>
              <Text style={[styles.menuEmail, rtlText(dir)]} numberOfLines={1}>
                {me?.email ?? (loading ? t("history.loading") : t("settingsAuthNav.signedIn"))}
              </Text>
            </View>
            <PressRow
              dim={0.2}
              onPress={() => {
                setOpen(false);
                router.navigate("/settings");
              }}
              style={[styles.menuItem, rtlRow(dir), { justifyContent: "space-between" }]}
            >
              <View style={[styles.menuItemLeft, rtlRow(dir)]}>
                <SymbolView name="gearshape" tintColor={C.t3} size={14} />
                <Text style={styles.menuItemText}>{t("settings.title")}</Text>
              </View>
              <SymbolView
                name={rtl ? "chevron.left" : "chevron.right"}
                tintColor={C.t4}
                size={12}
                weight="semibold"
              />
            </PressRow>
            <View style={styles.menuDivider} />
            <PressRow
              dim={0.2}
              onPress={() => {
                setOpen(false);
                void signOut();
              }}
              style={[styles.menuItem, rtlRow(dir)]}
            >
              <View style={[styles.menuItemLeft, rtlRow(dir)]}>
                <SymbolView name="xmark" tintColor={C.t3} size={13} />
                <Text style={styles.menuItemText}>{t("settingsAuthNav.signOut")}</Text>
              </View>
            </PressRow>
          </View>
        </Animated.View>
      </AnchoredPopover>
    </>
  );
}

const styles = StyleSheet.create({
  pressRow: { overflow: "hidden" },
  overlayBlack: { backgroundColor: "#000" },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  head: { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center", gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: `${C.accent}40`,
  },
  avatarClip: { flex: 1, borderRadius: 24, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  initial: { color: C.accent, fontSize: 15, fontWeight: "700" },
  avatarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: C.w,
    borderRightColor: "transparent",
  },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: "center", gap: 8, minWidth: 0 },
  name: { color: C.w, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  email: { color: C.t3, fontSize: 12 },
  imageError: { color: C.red, fontSize: 11, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.border },
  nameEdit: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowTitle: { color: C.w, fontSize: 14, fontWeight: "600" },
  rowSub: { color: C.t3, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase" },

  // AccountMenu
  menuTrigger: { width: 36, height: 36, borderRadius: 12 },
  // The Pressable has no border, so its absolute fill IS the tile's border box.
  menuTriggerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    boxShadow: MENU_LIT_SHADOW,
  },
  menuTile: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    borderWidth: 1,
  },
  menuTileClip: { flex: 1, borderRadius: 11, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  menuInitial: { color: C.accent, fontSize: 12, fontWeight: "700" },
  menuPanel: { backgroundColor: "transparent", borderWidth: 0, boxShadow: [] },
  menuCard: {
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
    boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
  },
  menuClip: { borderRadius: 11, overflow: "hidden" },
  menuHead: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  menuNameRow: { alignItems: "center", gap: 8, minWidth: 0 },
  menuName: { color: C.w, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  menuEmail: { color: C.t3, fontSize: 12 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", gap: 8 },
  menuItemLeft: { alignItems: "center", gap: 8 },
  menuItemText: { color: C.t2, fontSize: 13, fontWeight: "600" },
  menuDivider: { height: 1, backgroundColor: C.border },
});
