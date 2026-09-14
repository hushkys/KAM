// Monochrome interface icons: one 24-unit grid, 1.7 stroke, round joins.
// A control is monochrome (it inherits currentColor, so hover and active
// states colour it for free); things that stand for a place in the app are
// the coloured ModuleIcon family instead.

import type { SVGProps } from "react";

const P: Record<string, string> = {
  search: "M20 20l-4.2-4.2M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  close: "M6 6l12 12M18 6L6 18",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M6 15l6-6 6 6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  "arrow-up-right": "M7 17L17 7M9 7h8v8",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  gift: "M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 7s1.5-4 4-4a2.5 2.5 0 0 1 0 5",
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  bell: "M18 9a6 6 0 0 0-12 0c0 7-3 8.5-3 8.5h18S18 16 18 9M13.7 20.5a2 2 0 0 1-3.4 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z",
  monitor: "M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.2",
  landmark: "M12 3l9 5H3l9-5zM5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 21h18M4 17.5h16",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 3.5l9 16H3zM12 10v4.2M12 17v.2",
  filter: "M4 5h16l-6 7.5V19l-4 1.5v-8z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  sparkle: "M12 3.5c.8 4.4 2.6 6.2 7 7-4.4.8-6.2 2.6-7 7-.8-4.4-2.6-6.2-7-7 4.4-.8 6.2-2.6 7-7zM19 3v3M17.5 4.5h3",
  send: "M4.5 12L20 4.5 13.5 20l-2.3-6z M11.2 14L20 4.5",
  stop: "M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  refresh: "M20 11.5a8 8 0 1 0-2.4 5.9M20 5v6.5h-6.5",
  pin: "M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  menu: "M4 7h16M4 12h16M4 17h16",
  sidebar: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16",
  dock: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 15h18",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  play: "M8 5.5v13l10.5-6.5z",
  save: "M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 4v5h7V4M8 20v-6h8v6",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.5 3.5 5.2",
  book: "M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h14v-4",
  shield: "M12 3l8 3v6c0 5-3.5 8.2-8 9-4.5-.8-8-4-8-9V6z",
  database: "M12 9c3.9 0 7-1.3 7-3s-3.1-3-7-3-7 1.3-7 3 3.1 3 7 3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3",
  chart: "M4 20V11M10 20V5M16 20v-7M21 20H3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  map: "M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7zM9 4v13M15 7v13",
  "trend-up": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "trend-down": "M3 7l6 6 4-4 8 8M15 17h6v-6",
  flat: "M4 12h16M16 8l4 4-4 4",
  spike: "M3 16h5l2-9 3 13 2-6h6",
  sliders: "M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4",
  home: "M4 11l8-6.5 8 6.5M6 9.5V20h12V9.5M10 20v-5.5h4V20",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  calendar: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4",
  message: "M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
  keyboard: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 10h.01M11 10h.01M15 10h.01M8 14h8",
  contrast: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18",
  text: "M4 18l5-12 5 12M6.2 13.5h5.6M15 18l3-7 3 7M16 16.2h4",
  motion: "M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  bus: "M7 3.5h10a2 2 0 0 1 2 2V17H5V5.5a2 2 0 0 1 2-2zM5 11h14M7.5 20.5V17M16.5 20.5V17M8 14h.01M16 14h.01",
  school: "M3 9l9-5 9 5-9 5zM7 11.2V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-4.8M21 9v5",
  health: "M8 3.5h8v5h5v7h-5v5H8v-5H3v-7h5z",
  heart: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z",
  house: "M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5M9.5 20v-5h5v5",
  leaf: "M5 19C5 10.5 10 5 19.5 4.5 19 14 13.5 19 5 19zM5 19l7.5-7.5",
  coins: "M9 10c3.3 0 6-1.1 6-2.5S12.3 5 9 5 3 6.1 3 7.5 5.7 10 9 10zM3 7.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5M3 11.5v4C3 16.9 5.7 18 9 18c1.1 0 2.1-.1 3-.4M15 13c3.3 0 6-1.1 6-2.5S18.3 8 15 8M21 10.5v6c0 1.4-2.7 2.5-6 2.5-1.8 0-3.4-.3-4.5-.9",
  wand: "M4 20L15 9M14 4v2M19 9h2M18.5 5.5L17 7M9.5 4.5l1 1M19.5 14.5l-1-1",
  question: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.2",
  history: "M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4M12 8v4.5l3 2",
  print: "M7 9V3.5h10V9M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6.5H7z",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  gauge: "M4.5 17a8.5 8.5 0 1 1 15 0M12 13l4-5",
  split: "M6 4v5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v5M18 4v5a3 3 0 0 1-3 3M6 20v-5",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, strokeWidth = 1.7, ...rest }: { name: string; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  const d = P[name] ?? P.info;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={d} />
    </svg>
  );
}

export function hasIcon(name: string): boolean {
  return name in P;
}

export const PILLAR_ICON: Record<string, string> = {
  demografie: "users",
  doprava: "bus",
  skolstvi: "school",
  zdravotnictvi: "health",
  socialni: "heart",
  bydleni: "house",
  prostredi: "leaf",
  kultura: "landmark",
  finance: "coins",
  bezpecnost: "shield",
  sluzby: "home",
  jine: "info",
  ostatni: "grid",
};
