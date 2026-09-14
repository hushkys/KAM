// Team portraits, drawn as simple flat busts so they sit with the rest of the
// geometric visual language. Each has its own palette; none is a photo.

import type { ReactElement } from "react";

interface Look { bg: string; skin: string; hair: string; shirt: string; hairPath: string; extra?: ReactElement; shade: string }

const LOOKS: Record<string, Look> = {
  ondrej: {
    bg: "#1d4a2f", skin: "#6a4330", shade: "#553423", hair: "#141414", shirt: "#8fcb6b",
    hairPath: "M31 40c-1-11 7-19 17-19s18 7 17 19c-2-4-5-6-8-6-2-3-6-4-9-4s-7 1-9 4c-3 0-6 2-8 6z M33 33a4 4 0 1 1 6-4 M44 26a4 4 0 1 1 7 0 M55 29a4 4 0 1 1 6 4",
    extra: <path d="M36 74c4 3 8 4 12 4s8-1 12-4" stroke="#5a9e44" strokeWidth="3" fill="none" strokeLinecap="round" />,
  },
  josef: {
    bg: "#2a3f5c", skin: "#f0c7a1", shade: "#dcae86", hair: "#6b4226", shirt: "#e9b44c",
    hairPath: "M30 42c0-13 8-21 19-21 9 0 16 5 17 14-5-3-11-4-18-2-6 2-12 5-18 9z",
    extra: <path d="M39 50h6M51 50h6" stroke="#2b2b2b" strokeWidth="2.2" strokeLinecap="round" />,
  },
  matej: {
    bg: "#3b2f55", skin: "#f3cfb0", shade: "#e0b692", hair: "#e3c26a", shirt: "#1b1b1f",
    hairPath: "M30 41c-2-12 6-21 18-21 11 0 19 8 18 19l-4-3-3 4-4-5-4 4-4-5-4 4-4-4-3 5z",
  },
  damian: {
    bg: "#123f3f", skin: "#e5b58c", shade: "#cf9c72", hair: "#2c1d14", shirt: "#7a8a86",
    hairPath: "M31 42c-1-12 6-21 17-21 6 0 13 2 16 9 1 3 1 7 1 11-3-6-8-9-15-10-7 0-13 3-19 11z",
    extra: <path d="M29 60c0 10 8 17 19 17s19-7 19-17" stroke="#c9d6d2" strokeWidth="4" fill="none" strokeLinecap="round" />,
  },
};

export function Avatar({ who, size = 96, title }: { who: keyof typeof LOOKS | string; size?: number; title?: string }) {
  const l = LOOKS[who] ?? LOOKS.ondrej;
  const id = `av-${who}`;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={title ?? "Portrét"}>
      <defs>
        <clipPath id={`${id}-c`}><circle cx="48" cy="48" r="48" /></clipPath>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={l.bg} /><stop offset="1" stopColor={l.bg} stopOpacity=".7" /></linearGradient>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="96" height="96" fill={`url(#${id}-g)`} />
        <path d="M14 100c2-18 16-28 34-28s32 10 34 28z" fill={l.shirt} />
        <path d="M41 64h14v10c-2 3-5 4-7 4s-5-1-7-4z" fill={l.shade} />
        <ellipse cx="48" cy="47" rx="17" ry="19" fill={l.skin} />
        <ellipse cx="31.5" cy="49" rx="3" ry="4.5" fill={l.skin} />
        <ellipse cx="64.5" cy="49" rx="3" ry="4.5" fill={l.skin} />
        <path d={l.hairPath} fill={l.hair} stroke={l.hair} strokeWidth="1" strokeLinejoin="round" />
        <circle cx="42" cy="50" r="1.9" fill="#1d1d1d" />
        <circle cx="54" cy="50" r="1.9" fill="#1d1d1d" />
        <path d="M43 58c3 2.4 7 2.4 10 0" stroke="#1d1d1d" strokeOpacity=".75" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {l.extra}
      </g>
    </svg>
  );
}

export const TEAM = [
  { who: "ondrej", name: "Ondřej Hušek", role: "Full-stack software & AI inženýr", school: "UHK · FIM · Informační a síťová bezpečnost", lead: true },
  { who: "josef", name: "Josef Efler", role: "Marketing a brainstorming", school: "Univerzita Tomáše Bati ve Zlíně", lead: true },
  { who: "matej", name: "Matěj Jirásek", role: "UX/UI designer", school: "UHK · FIM · Informační a síťová bezpečnost", lead: false },
  { who: "damian", name: "Damián Roháček", role: "Backend developer", school: "UHK · FIM · Informační a síťová bezpečnost", lead: false },
];
