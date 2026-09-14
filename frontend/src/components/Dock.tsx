// The dock: the app's places, floating at the bottom (or down the side on a
// wide screen, if chosen in Nastavení). On a phone it keeps the four main
// places and folds the rest into "Více", which opens a sheet.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Link, useLocation } from "../lib/router";
import { Icon } from "./Icon";
import { ModuleIcon } from "./ModuleIcon";
import { NAV } from "./nav";
import { Modal } from "./ui";

/** What "Více" opens, grouped so a list of ten does not read as one heap.
 *  The pages come from NAV so a place added there cannot go missing here. */
const MORE_SECTIONS: { title: string; items: { path: string; label: string; module: string; desc: string }[] }[] = [
  { title: "Analýza", items: NAV.filter((n) => n.extra && n.group === "main") },
  { title: "Nástroje", items: NAV.filter((n) => n.extra && n.group === "tools") },
  {
    title: "O aplikaci",
    items: [
      { path: "/o-nas", label: "O nás", module: "onas", desc: "Tým Popojedem. a projekt KAM" },
      { path: "/pravni", label: "Právní informace", module: "nastaveni", desc: "Podmínky, soukromí, AI" },
    ],
  },
];

interface Box { x: number; y: number; w: number; h: number }

/** The highlight travels between places instead of appearing at the new one.
 *
 *  Two shapes, not one: a leading pill and a trail that is given a longer
 *  duration, so mid-journey they sit apart — and the goo filter on their shared
 *  layer fuses that gap into a neck that stretches and snaps. One travelling
 *  box can only ever slide.
 *
 *  The squash is a three-keyframe WAAPI animation rather than a CSS transition,
 *  because a transition interpolates start to end and the stretch has to happen
 *  *between* them. Width is animated too — dock items are not equal width, and
 *  a fixed-width pill visibly over- or undershoots its target.
 */
function useTravellingHighlight(path: string) {
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const trail = useRef<HTMLSpanElement>(null);
  const last = useRef<Box | null>(null);
  const running = useRef<Animation[]>([]);
  const retry = useRef(0);

  const place = useCallback((animate: boolean) => {
    const box = nav.current, lead = pill.current, tail = trail.current;
    if (!box || !lead || !tail) return;
    const layer = lead.parentElement as HTMLElement;
    const active = box.querySelector<HTMLElement>('.dock-item[aria-current="page"]');
    if (!active) { layer.dataset.empty = "true"; last.current = null; return; }

    const cr = box.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    // Zero-size happens while a webfont has not swapped in or the bar is still
    // hidden. Retrying next frame is the difference between "not yet" and
    // "never" — without it the pill stays wherever it last succeeded.
    if (!ar.width || !cr.width) {
      if (retry.current < 8) { retry.current += 1; requestAnimationFrame(() => place(animate)); }
      return;
    }
    retry.current = 0;
    const next: Box = { x: ar.left - cr.left + box.scrollLeft, y: ar.top - cr.top + box.scrollTop, w: ar.width, h: ar.height };
    const prev = last.current;

    // A re-measure with nothing to correct must not restart anything, or a
    // resize mid-journey would cancel the glide and drop the pill on target.
    const settled = prev && Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5
      && Math.abs(next.w - prev.w) < 0.5 && Math.abs(next.h - prev.h) < 0.5;
    if (settled && running.current.length) return;

    for (const a of running.current) { try { a.cancel(); } catch { /* already gone */ } }
    running.current = [];

    // Park first: these are the values the animations settle onto, so when the
    // forwards fill is cancelled at the end there is nothing left to jump to.
    const park = (el: HTMLElement) => {
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
      el.style.transform = `translate(${next.x}px, ${next.y}px)`;
    };
    layer.dataset.empty = "false";
    park(lead); park(tail);

    const reduced = document.documentElement.dataset.motion === "reduce"
      || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || !prev || reduced) { last.current = next; return; }

    const travel = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
    const stretch = travel > 4 ? Math.min(1.22, 1 + travel / 900) : 1;
    const frames = (squash: number): Keyframe[] => [
      { transform: `translate(${prev.x}px, ${prev.y}px) scaleX(1)`, width: `${prev.w}px`, height: `${prev.h}px` },
      { transform: `translate(${(prev.x + next.x) / 2}px, ${(prev.y + next.y) / 2}px) scaleX(${squash})`, width: `${(prev.w + next.w) / 2}px`, offset: 0.45 },
      { transform: `translate(${next.x}px, ${next.y}px) scaleX(1)`, width: `${next.w}px`, height: `${next.h}px` },
    ];
    const run = (el: HTMLElement, kf: Keyframe[], duration: number) => {
      const anim = el.animate(kf, { duration, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      anim.finished.then(() => anim.cancel()).catch(() => { /* superseded */ });
      running.current.push(anim);
    };
    run(lead, frames(stretch), 460);
    // Slower, so the trail is still leaving as the pill arrives — that lag is
    // the whole source of the stretched neck between them.
    run(tail, frames(1), 640);
    last.current = next;
  }, []);

  // Before paint, so the highlight is never briefly missing on first render.
  useLayoutEffect(() => { place(true); }, [path, place]);
  useEffect(() => {
    const again = () => place(false);
    const ro = new ResizeObserver(again);
    if (nav.current) ro.observe(nav.current);
    window.addEventListener("resize", again);
    // The first placement can land before the webfont swaps in, and fallback
    // metrics give different label widths — enough to sit a few pixels off.
    document.fonts?.ready.then(again).catch(() => { /* no webfont */ });
    return () => { ro.disconnect(); window.removeEventListener("resize", again); };
  }, [place]);

  return { nav, pill, trail };
}

export function Dock() {
  const { path } = useLocation();
  const [more, setMore] = useState(false);
  // Klepnutí na ikonu spustí její vlastní animaci. Třída se po doběhnutí zase
  // sundá, aby šla spustit znovu — a `onPointerDown`, ne `onClick`: animace
  // má začít pod prstem, ne až se stránka přepne.
  const [tap, setTap] = useState<string | null>(null);
  const tapCas = useRef<number | undefined>(undefined);
  const klepni = (modul: string) => {
    window.clearTimeout(tapCas.current);
    setTap(null);
    requestAnimationFrame(() => setTap(modul));
    tapCas.current = window.setTimeout(() => setTap(null), 720);
  };
  useEffect(() => () => window.clearTimeout(tapCas.current), []);
  const ind = useTravellingHighlight(path);
  useEffect(() => setMore(false), [path]);
  const current = (p: string) => path === p || path.startsWith(`${p}/`);
  const extraActive = NAV.some((n) => n.extra && current(n.path));
  return (
    <>
      {/* The goo. Two solid shapes blurred together and then thresholded back
          to hard alpha, so they fuse with a neck instead of overlapping as two
          separate blobs — nothing else produces that liquid stretch and snap.
          The offset is exactly half the multiplier, which puts the alpha cutoff
          at 0.5: a blurred edge crosses 0.5 at the *original* silhouette, so
          the pill comes back at its true size instead of a halo wider than the
          item it sits on. */}
      <svg className="goo-defs" aria-hidden="true" focusable="false">
        <filter id="dock-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
        </filter>
      </svg>
      <nav className="dock glass" aria-label="Hlavní navigace" ref={ind.nav}>
        <span className="dock-morph" data-empty="true" aria-hidden="true">
          <span className="dock-pill dock-trail" ref={ind.trail} />
          <span className="dock-pill" ref={ind.pill} />
        </span>
        {NAV.map((n, i) => (
          <Fragment key={n.path}>
            {i > 0 && NAV[i - 1].group !== n.group && <span className="dock-sep" aria-hidden="true" />}
            <Link to={n.path} className={`dock-item ${n.extra ? "is-extra" : ""}${tap === n.module ? " is-tap" : ""}`}
              aria-current={current(n.path) ? "page" : undefined} title={n.desc} onPointerDown={() => klepni(n.module)}>
              <ModuleIcon name={n.module} />
              <span className="dock-label">{n.label}</span>
            </Link>
          </Fragment>
        ))}
        <button className="dock-item dock-more" aria-current={extraActive ? "page" : undefined} aria-expanded={more} onClick={() => setMore(true)}>
          <span className="more-dots" aria-hidden="true"><Icon name="grid" size={24} /></span>
          <span className="dock-label">Více</span>
        </button>
      </nav>
      {/* Rows, not a grid of squares. Two columns of tiles wrap their
          descriptions to different heights, so nothing lines up and the eye has
          no column to run down; a full-width row is scannable, and it is a
          target the width of the screen instead of half of it. */}
      <Modal open={more} onClose={() => setMore(false)} title="Další" sheet>
        <div className="more-list">
          {MORE_SECTIONS.map((section) => (
            <Fragment key={section.title}>
              <h3 className="more-group">{section.title}</h3>
              {section.items.map((n) => (
                <Link key={n.path} to={n.path} className="more-row" aria-current={current(n.path) ? "page" : undefined}>
                  <span className="more-icon"><ModuleIcon name={n.module} size={26} /></span>
                  <span className="more-text">
                    <span className="more-label">{n.label}</span>
                    <span className="more-desc">{n.desc}</span>
                  </span>
                  <Icon name="chevron-right" size={18} />
                </Link>
              ))}
            </Fragment>
          ))}
        </div>
      </Modal>
    </>
  );
}
