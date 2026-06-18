import { JSX } from "react";

export type IconName =
  | "mic"
  | "pause"
  | "play"
  | "stop"
  | "history"
  | "back"
  | "sparkle"
  | "copy"
  | "doc"
  | "chevron"
  | "globe"
  | "swap"
  | "check"
  | "trash"
  | "edit"
  | "close"
  | "speaker"
  | "speakerOff"
  | "search"
  | "settings"
  | "more";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 20,
  color = "currentColor",
  className,
  strokeWidth = 2,
}: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
  } as const;

  const icons: Record<IconName, JSX.Element> = {
    mic: (
      <svg
        {...common}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0014 0" />
        <line x1="12" y1="20" x2="12" y2="24" />
      </svg>
    ),
    pause: (
      <svg {...common} fill={color}>
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
    ),
    play: (
      <svg {...common} fill={color}>
        <path d="M6 4l14 8-14 8V4z" />
      </svg>
    ),
    stop: (
      <svg {...common} fill={color}>
        <rect x="5" y="5" width="14" height="14" rx="2" />
      </svg>
    ),
    history: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
    back: (
      <svg {...common} fill="none" stroke={color} strokeWidth={2.5}>
        <path d="M15 4l-8 8 8 8" />
      </svg>
    ),
    sparkle: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    ),
    copy: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
      </svg>
    ),
    doc: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" />
        <path d="M14 2v6h6" />
      </svg>
    ),
    chevron: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    ),
    globe: (
      <svg {...common} fill="none" stroke={color} strokeWidth={1.5}>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
    swap: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
      </svg>
    ),
    check: (
      <svg {...common} fill="none" stroke={color} strokeWidth={2.5}>
        <path d="M5 13l4 4 10-10" />
      </svg>
    ),
    trash: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6v14a2 2 0 002 2h8a2 2 0 002-2V6" />
      </svg>
    ),
    edit: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    more: (
      <svg {...common} fill={color}>
        <circle cx="12" cy="5" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="12" cy="19" r="1.7" />
      </svg>
    ),
    close: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth}>
        <path d="M6 6l12 12M6 18L18 6" />
      </svg>
    ),
    speaker: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5L6 9H3v6h3l5 4V5z" fill={color} />
        <path d="M16 8a5 5 0 010 8" />
        <path d="M19 5a9 9 0 010 14" />
      </svg>
    ),
    speakerOff: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5L6 9H3v6h3l5 4V5z" fill={color} />
        <path d="M22 9l-5 5M17 9l5 5" />
      </svg>
    ),
    search: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
    settings: (
      <svg {...common} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };

  return icons[name];
}
