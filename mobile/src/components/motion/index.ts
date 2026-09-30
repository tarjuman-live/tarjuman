/** Motion primitives — see each file's header for the web recipe it mirrors. */
export { PressableScale, type PressableScaleProps, type GlowSpec, type PressColors } from "./pressable-scale";
export { Pulse, usePulse, usePulseValue, startPulse } from "./pulse";
export { Spinner, type SpinnerProps } from "./spinner";
export { Skeleton, HeaderSkeleton, SegmentSkeleton } from "./skeleton";
export {
  Reveal,
  RevealScrollView,
  useRevealScroll,
  useInView,
  type RevealProps,
  type RevealScrollContext,
  type InViewMode,
  type InViewOptions,
} from "./reveal";
export { HeadingReveal, type HeadingRevealProps } from "./heading-reveal";
export { HoverCard, useHoverProgress, type HoverCardProps } from "./hover-card";
export { Collapsible, type CollapsibleProps } from "./collapsible";
export { usePresence, usePresenceProgress, type PresenceOptions } from "./presence";
export { AnchoredPopover, type AnchoredPopoverProps, type PopoverPlacement } from "./popover";
export { ScreenEnter, type ScreenEnterProps } from "./screen-enter";
export { useTypewriter, createTypewriterPump, type TypewriterPump } from "./use-typewriter";
