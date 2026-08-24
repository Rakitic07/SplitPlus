import { useId } from "react";
import { cn } from "@/lib/utils";

// The Split+ mark: a warm squircle (orange → amber → gold, matching the app
// theme) with a two-way "transfer" glyph — money moving between people, i.e.
// splitting a bill. Used in the header, auth screen and splash.
export function LogoMark({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Split+"
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="0.55" stopColor="#ffab33" />
          <stop offset="1" stopColor="#ffc23d" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="17" fill={`url(#${id}-fill)`} />
      <rect x="4" y="4" width="56" height="56" rx="17" fill={`url(#${id}-shine)`} />
      <g
        stroke="#ffffff"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* top arrow → */}
        <path d="M19 25 H40" />
        <path d="M34 19 L42 25 L34 31" />
        {/* bottom arrow ← */}
        <path d="M45 39 H24" />
        <path d="M30 33 L22 39 L30 45" />
      </g>
    </svg>
  );
}

// Mark + wordmark lockup.
export function Logo({
  size = 34,
  className,
  textClassName,
}: {
  size?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span className={cn("font-black tracking-tight gradient-text", textClassName)}>Split+</span>
    </span>
  );
}
