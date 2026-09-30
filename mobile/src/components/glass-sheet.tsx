/**
 * GlassSheet — native parity for the vaul bottom drawer (src/components/ui/
 * drawer.tsx: language picker, positioning tips).
 *
 *   OPEN : sheet slides up translateY(100%) → 0, backdrop (rgba(6,11,24,.4),
 *          no blur of its own) fades 0 → 1 — both .5s bezier(.32,.72,0,1).
 *   CLOSE: slides back down from WHEREVER it is (mid-drag included), backdrop
 *          fades out; kept mounted until the exit finishes.
 *   DRAG : follows the finger 1:1 downward, backdrop opacity = 1 − dy/h;
 *          upward overdrag is log-damped (vaul dampenValue); release closes if
 *          avg velocity > .4 px/ms or dragged ≥ 25% of the height, else it
 *          settles back (same .5s curve).
 *   WHO DRAGS (vaul shouldDrag, node_modules/vaul/dist/index.mjs:971-1027,
 *          which walks up from the TOUCH TARGET):
 *          - never from the `header` slot (vaul data-vaul-no-drag, e.g. search);
 *          - never in the first 500ms after open (vaul openTime guard);
 *          - always while the sheet is displaced downward (vaul swipeAmount > 0);
 *          - never when the gesture starts UPWARD (vaul isDraggingInDirection),
 *            and not again until 100ms passed since the last refusal while the
 *            sheet is at rest (vaul scrollLockTimeout), so a gesture that began
 *            as a list scroll never turns into a sheet drag mid-way;
 *          - a touch that STARTS outside the <GlassSheetScrollView> (grabber,
 *            title block, any non-scrolling header) drags even when the list is
 *            scrolled down;
 *          - a touch that STARTS inside it drags only when the list is at the top
 *            (the pull is downward by the rule above); otherwise the list scrolls.
 *            "Starts" = the touch-DOWN point, recorded in the pan's onBegin (RNGH
 *            resets translation at activation on iOS, so y − translationY would
 *            be the activation point, ≥6pt past the real touch-down);
 *          - never while the sheet is closing (open=false, exit in flight): vaul's
 *            content is unmounted by Radix at that point, and a grab here would
 *            cancel the exit so the sheet never unmounts.
 *   SCROLLER = WHOLE SHEET: when the only child is one <GlassSheetScrollView> and
 *          there is no `header` (positioning tips: web DrawerContent is itself
 *          `overflow-auto`, with drawer.tsx's grabber INSIDE it), the grabber is
 *          rendered inside the scroller — it scrolls away with the content and,
 *          like every other point, can't start a drag while the content is
 *          scrolled (vaul's upward walk hits the scrolled role=dialog). Override
 *          with `scrollWholeSheet`.
 *   LOOK : glass panel, radius-top 24, 44×4 white/15 grabber, max-h 75% of the
 *          window, max-w 440, sits above the keyboard.
 *   Reduce Motion: IGNORED on purpose — web parity. vaul (and drawer.tsx /
 *   positioning-tips.tsx / language-picker-sheet.tsx) have no reduced-motion
 *   handling, so web reduce users still get the .5s slide in AND out; so do we.
 *
 *   <GlassSheet open={open} onClose={() => setOpen(false)} header={<Search/>}>
 *     <GlassSheetScrollView>…rows…</GlassSheetScrollView>
 *   </GlassSheet>
 *
 * `onClose` is called for backdrop tap, swipe-down and the hardware/back
 * request; it MUST set `open` to false (the sheet is controlled).
 * One GlassSheetScrollView per sheet.
 */
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedScrollViewProps,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VAUL } from "~/lib/motion";
import { useT } from "~/i18n";
import { GlassBackground, GLASS } from "./glass";

const T = { duration: VAUL.duration, easing: VAUL.easing, reduceMotion: ReduceMotion.Never };

/** vaul SCROLL_LOCK_TIMEOUT (index.mjs:448) and its 500ms openTime guard. */
const SCROLL_LOCK_MS = 100;
const OPEN_GUARD_MS = 500;

interface SheetScrollCtx {
  listY: SharedValue<number>;
  listScrollable: SharedValue<boolean>;
  /** The scroller's vertical extent in the drag surface's coordinates. */
  listTop: SharedValue<number>;
  listBottom: SharedValue<number>;
  /** The drag surface (pan view) — measureLayout target. */
  surfaceRef: RefObject<View | null>;
  /** Set by the scroller: re-measures its band (surface layout changed). */
  measureList: RefObject<(() => void) | null>;
  native: GestureType;
  /** Web DrawerContent-is-the-scroller layout: the scroller draws the grabber. */
  handleInList: boolean;
  showHandle: boolean;
}
const ScrollCtx = createContext<SheetScrollCtx | null>(null);

export interface GlassSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after the close animation finished and the sheet unmounted. */
  onClosed?: () => void;
  children?: ReactNode;
  /** Non-draggable slot under the grabber (vaul data-vaul-no-drag). */
  header?: ReactNode;
  /** Fraction of window height (default .75 = max-h-[75dvh]). */
  maxHeightRatio?: number;
  /** Default 440 (max-w-[440px]). */
  maxWidth?: number;
  showHandle?: boolean;
  /** Extra style for the sheet content container. */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * The scroller IS the sheet (web: DrawerContent `overflow-auto`): the grabber
   * scrolls with the content and no point outside the list exists. Default:
   * true when there is no `header` and the only child is a GlassSheetScrollView.
   */
  scrollWholeSheet?: boolean;
  accessibilityLabel?: string;
}

export function GlassSheet({
  open,
  onClose,
  onClosed,
  children,
  header,
  maxHeightRatio = 0.75,
  maxWidth = 440,
  showHandle = true,
  contentStyle,
  accessibilityLabel,
  scrollWholeSheet,
}: GlassSheetProps) {
  const t = useT();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);

  const ty = useSharedValue(win.height); // off-screen until measured
  const backdrop = useSharedValue(0);
  const h = useSharedValue(0);
  const listY = useSharedValue(0);
  const listScrollable = useSharedValue(false);
  // No scroller measured yet → an empty band, so every touch counts as outside.
  const listTop = useSharedValue(0);
  const listBottom = useSharedValue(0);
  const openAt = useSharedValue(0);
  // Mirrors `open` on the UI thread: no drag may start (or continue) while the
  // sheet is closing, or it would overwrite ty and cancel the exit's `done`.
  const isOpen = useSharedValue(open);
  // Touch-DOWN y in the surface's coordinates (pan onBegin).
  const originY = useSharedValue(0);
  const lastPrevented = useSharedValue(0);
  const surfaceRef = useRef<View>(null);
  const dragging = useSharedValue(false);
  const base = useSharedValue(0);
  const startT = useSharedValue(0);
  const hRef = useRef(0);
  const pendingIn = useRef(open);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const finishClose = () => {
    setMounted(false);
    onClosedRef.current?.();
  };

  const animateIn = () => {
    pendingIn.current = false;
    const hh = hRef.current;
    if (ty.value > hh) ty.value = hh;
    openAt.value = Date.now();
    ty.value = withTiming(0, T);
    backdrop.value = withTiming(1, T);
  };

  const animateOut = () => {
    const hh = hRef.current || win.height;
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(finishClose);
    };
    backdrop.value = withTiming(0, T);
    ty.value = withTiming(hh, T, done);
  };

  useEffect(() => {
    isOpen.value = open; // before animateOut, so a drag can't cancel the exit
    if (open) {
      setMounted(true);
      if (hRef.current > 0) animateIn();
      else pendingIn.current = true;
    } else if (mounted) {
      pendingIn.current = false;
      animateOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const hh = e.nativeEvent.layout.height;
    hRef.current = hh;
    h.value = hh;
    if (pendingIn.current && open) animateIn();
  };

  const requestClose = () => onClose();

  // ── Gestures ──
  const native = useMemo(() => Gesture.Native(), []);
  const headerBlock = useMemo(() => Gesture.Pan().activeOffsetY([-6, 6]), []);
  const hasHeader = !!header;
  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .activeOffsetY([-6, 6])
      .failOffsetX([-24, 24])
      .simultaneousWithExternalGesture(native);
    if (hasHeader) g.requireExternalGestureToFail(headerBlock);
    return g
        .onBegin((e) => {
          // BEGAN fires at touch-down with the touch-down location; translation
          // is reset at activation (iOS), so this is the only true origin.
          originY.value = e.y;
          dragging.value = false;
          base.value = 0;
        })
        .onUpdate((e) => {
          if (!isOpen.value) {
            // Closing (parent set open=false, exit in flight): never grab it,
            // and let go of a drag that was running — animateOut owns ty now.
            dragging.value = false;
            return;
          }
          if (!dragging.value) {
            // vaul shouldDrag, in its order (index.mjs:971-1027).
            const now = Date.now();
            const d0 = e.translationY - base.value;
            let allow: boolean;
            if (now - openAt.value < OPEN_GUARD_MS) {
              allow = false; // "Allow scrolling when animating"
            } else if (ty.value > 0.5) {
              allow = true; // swipeAmount > 0: grab a displaced sheet anywhere
            } else if (lastPrevented.value > 0 && now - lastPrevented.value < SCROLL_LOCK_MS) {
              lastPrevented.value = now;
              allow = false;
            } else if (d0 < 0) {
              lastPrevented.value = now; // dragging up: let it scroll
              allow = false;
            } else {
              // Walk up from the touch TARGET: only a touch that began inside
              // the scroller defers to it, and only while it is scrolled.
              const y0 = originY.value;
              const inList = y0 >= listTop.value && y0 < listBottom.value;
              if (inList && listScrollable.value && listY.value > 0.5) {
                lastPrevented.value = now;
                allow = false;
              } else {
                allow = true;
              }
            }
            if (!allow) {
              base.value = e.translationY;
              return;
            }
            dragging.value = true;
            base.value = e.translationY;
            startT.value = Date.now();
          }
          const d = e.translationY - base.value;
          if (d >= 0) {
            ty.value = d;
            backdrop.value = h.value > 0 ? 1 - d / h.value : 1;
          } else {
            const up = -d;
            ty.value = Math.min(-(8 * (Math.log(up + 1) - 2)), 0);
            backdrop.value = 1;
          }
        })
        .onEnd((e) => {
          if (!dragging.value) return;
          dragging.value = false;
          if (!isOpen.value) {
            // Belt and braces: closed mid-drag — finish the exit AND unmount.
            backdrop.value = withTiming(0, T);
            ty.value = withTiming(h.value, T, (finished) => {
              "worklet";
              if (finished) scheduleOnRN(finishClose);
            });
            return;
          }
          const d = e.translationY - base.value;
          const v = Math.abs(d) / Math.max(1, Date.now() - startT.value);
          if (d > 0 && (v > VAUL.velocityThreshold || d >= VAUL.closeThreshold * h.value)) {
            // Continue the slide-down from the finger right away; the parent's
            // open=false then re-targets the same animation and unmounts.
            ty.value = withTiming(h.value, T);
            backdrop.value = withTiming(0, T);
            scheduleOnRN(requestClose);
          } else {
            ty.value = withTiming(0, T);
            backdrop.value = withTiming(1, T);
          }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, headerBlock, hasHeader]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  const measureList = useRef<(() => void) | null>(null);
  const kids = Children.toArray(children);
  const handleInList =
    scrollWholeSheet ??
    (!header && kids.length === 1 && isValidElement(kids[0]) && kids[0].type === GlassSheetScrollView);
  const scrollCtx = useMemo<SheetScrollCtx>(
    () => ({ listY, listScrollable, listTop, listBottom, surfaceRef, measureList, native, handleInList, showHandle }),
    [listY, listScrollable, listTop, listBottom, native, handleInList, showHandle],
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("foundation.close")}
          />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding" style={styles.bottom} pointerEvents="box-none">
          <Animated.View
            onLayout={onSheetLayout}
            accessibilityViewIsModal
            accessibilityLabel={accessibilityLabel}
            style={[
              styles.sheet,
              GLASS.card,
              { maxHeight: win.height * maxHeightRatio, maxWidth, paddingBottom: insets.bottom },
              contentStyle,
              sheetStyle,
            ]}
          >
            <GlassBackground radius={24} topOnly />
            <ScrollCtx.Provider value={scrollCtx}>
              <GestureDetector gesture={pan}>
                {/* A header above the list growing/shrinking moves the list
                    without resizing it — re-measure its band on any change. */}
                <View ref={surfaceRef} style={styles.flexShrink} onLayout={() => measureList.current?.()}>
                  {handleInList ? null : <SheetHandle show={showHandle} />}
                  {header ? (
                    <GestureDetector gesture={headerBlock}>
                      <View>{header}</View>
                    </GestureDetector>
                  ) : null}
                  {children}
                </View>
              </GestureDetector>
            </ScrollCtx.Provider>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The sheet's scrollable list. Reports its offset AND its vertical band inside
 * the drag surface, so only a touch that starts in here defers to scrolling
 * (vaul shouldDrag walks up from the touch target). No top bounce, so a
 * pull-down at the top moves the SHEET, not the content.
 */
function SheetHandle({ show }: { show: boolean }) {
  return show ? <View style={styles.handle} /> : <View style={{ height: 12 }} />;
}

export function GlassSheetScrollView({
  children,
  onScroll: _ignored,
  contentContainerStyle,
  ...rest
}: AnimatedScrollViewProps & { children?: ReactNode }) {
  const ctx = useContext(ScrollCtx);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const listY = ctx?.listY;
  const scrollRef = useRef<Animated.ScrollView>(null);
  const layoutY = useRef(0);
  const setBand = (top: number, height: number) => {
    if (!ctx) return;
    ctx.listTop.value = top;
    ctx.listBottom.value = top + height;
  };
  const measure = () => {
    if (!ctx) return;
    // Parent-relative fallback: exact when the list is a direct child of the
    // surface (language picker, positioning tips).
    const fallback = () => setBand(layoutY.current, viewH.current);
    const node = scrollRef.current as unknown as View | null;
    const surface = ctx.surfaceRef.current;
    if (!node || !surface || typeof node.measureLayout !== "function") return fallback();
    try {
      node.measureLayout(surface, (_x, y, _w, hh) => setBand(y, hh), fallback);
    } catch {
      fallback();
    }
  };
  if (ctx) ctx.measureList.current = measure;
  useEffect(
    () => () => {
      if (!ctx) return;
      ctx.measureList.current = null; // one scroller per sheet
      ctx.listTop.value = 0;
      ctx.listBottom.value = 0;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const handler = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (listY) listY.value = e.contentOffset.y;
    },
  });
  const update = () => {
    if (ctx) ctx.listScrollable.value = contentH.current > viewH.current + 1;
  };
  const list = (
    <Animated.ScrollView
      ref={scrollRef}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      {...rest}
      // Whole-sheet scroller: the grabber sits ABOVE the caller's content
      // padding (web: grabber, then the px-6 pt-4 body, both in the scroller).
      contentContainerStyle={ctx?.handleInList ? undefined : contentContainerStyle}
      onScroll={handler}
      onLayout={(e) => {
        viewH.current = e.nativeEvent.layout.height;
        layoutY.current = e.nativeEvent.layout.y;
        update();
        measure();
      }}
      onContentSizeChange={(_w, hh) => {
        contentH.current = hh;
        update();
      }}
    >
      {ctx?.handleInList ? (
        <>
          <SheetHandle show={ctx.showHandle} />
          <Animated.View style={contentContainerStyle}>{children}</Animated.View>
        </>
      ) : (
        children
      )}
    </Animated.ScrollView>
  );
  if (!ctx) return list;
  return <GestureDetector gesture={ctx.native}>{list}</GestureDetector>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: VAUL.backdrop },
  bottom: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 0,
    marginTop: 96,
  },
  flexShrink: { flexShrink: 1 },
  handle: {
    alignSelf: "center",
    marginTop: 12,
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
});
