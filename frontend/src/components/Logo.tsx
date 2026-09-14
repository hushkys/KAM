// The KAM. wordmark, drawn as geometry so it needs no font and stays crisp.
// Heavy, square-shouldered letters after the brand sheet; the dot is the one
// place the lime appears at full strength.

import type { SVGProps } from "react";

const K = "M0 0h24v41L58 0h30L46 47l44 53H59L32 66l-8 8.6V100H0z";
const A = "M97 100L133 0h27l36 100h-25l-7.2-21h-37L119.6 100zM133.6 58h23l-11.5-34.5z";
const M = "M205 100V0h29l23.5 57L281 0h29v100h-23V43l-19.8 47h-15.4L228 43v57z";

export function Wordmark({ dot = true, ...rest }: { dot?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 346 100" role="img" aria-label="KAM." className="wordmark" {...rest}>
      <path d={`${K}${A}${M}`} fill="currentColor" fillRule="evenodd" />
      {dot && <circle cx="331" cy="86" r="14" fill="var(--lime)" />}
    </svg>
  );
}

/** Square app mark (favicon style), used in compact places. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="kam-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f5f3a" />
          <stop offset="1" stopColor="#0c2418" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#kam-mark-bg)" />
      <path d="M17 16h8v13.5L36.5 16h9.5L32.5 31.2 47 48h-10L28 37.2 25 40.3V48h-8z" fill="#f2f7f3" />
      <circle cx="47.5" cy="45" r="5" fill="#7fd957" />
    </svg>
  );
}
