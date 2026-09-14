// Small shared building blocks. Every screen is assembled from these so the
// layout grammar stays the same everywhere: a page header, a 12-column grid,
// cards with a title row, and the same tags for the same meanings.

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function PageHeader({ eyebrow, title, lead, actions, titleStyle }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; actions?: ReactNode; titleStyle?: CSSProperties }) {
  return (
    <header className="page-header reveal">
      <div className="page-header-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 style={titleStyle}>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, icon, actions, children, className = "", span, i, id, footer, flush }: {
  title?: ReactNode; icon?: string; actions?: ReactNode; children: ReactNode; className?: string; span?: number; i?: number; id?: string; footer?: ReactNode; flush?: boolean;
}) {
  return (
    <section id={id} className={`card reveal ${span ? `span-${span}` : ""} ${flush ? "is-flush" : ""} ${className}`} style={{ "--i": i ?? 0 } as CSSProperties}>
      {(title || actions) && (
        <div className="card-head">
          {title && (
            <h2 className="card-title">
              {icon && <Icon name={icon} size={17} />}
              <span>{title}</span>
            </h2>
          )}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

const KIND_LABEL: Record<string, string> = { FAKT: "Fakt", TREND: "Trend", MODEL: "Model", "SCÉNÁŘ": "Scénář", AI: "AI interpretace", "PŘEDPOKLAD": "Předpoklad", "ZÁSAH": "Zásah" };
export function KindTag({ kind }: { kind: string }) {
  const k = kind.toUpperCase();
  const cls = { FAKT: "fakt", TREND: "trend", MODEL: "model", "SCÉNÁŘ": "scenar", AI: "ai", "PŘEDPOKLAD": "predpoklad", "ZÁSAH": "zasah" }[k] ?? "fakt";
  return <span className={`kind kind-${cls}`}>{KIND_LABEL[k] ?? kind}</span>;
}

const LEVEL: Record<string, string> = { nizke: "Nízké", sledovat: "Sledovat", stredni: "Střední", vysoke: "Vysoké", kriticke: "Kritické" };
export function Severity({ level, label }: { level: string; label?: string }) {
  return (
    <span className={`sev sev-${level}`}>
      <span className="sev-dot" aria-hidden="true" />
      {label ?? LEVEL[level] ?? level}
    </span>
  );
}

export function Pill({ children, tone = "neutral", icon }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "bad" | "info"; icon?: string }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: {
  value: T; options: { value: T; label: ReactNode; icon?: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(value)}"]`);
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className={`segmented seg-${size}`} role="radiogroup" aria-label={label} ref={ref}>
      {thumb && <span className="segmented-thumb" style={{ transform: `translateX(${thumb.left - 3}px)`, width: thumb.width }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-value={o.value} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <label className="switch-row" htmlFor={id}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </span>
    </label>
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

export function LoadingCard({ lines = 3, span }: { lines?: number; span?: number }) {
  return (
    <section className={`card ${span ? `span-${span}` : ""}`} aria-busy="true">
      <Skeleton h={18} w="40%" />
      <div style={{ height: 14 }} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <Skeleton h={12} w={`${90 - i * 12}%`} />
        </div>
      ))}
    </section>
  );
}

export function Empty({ icon = "info", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: { message: string } | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" size={18} />
      <span>{error.message}</span>
      {retry && <button className="btn btn-quiet btn-sm" onClick={retry}>Zkusit znovu</button>}
    </div>
  );
}

/** The "i" mark: explanatory copy lives behind it, not in tinted boxes. */
export function InfoHint({ children, label = "Vysvětlení" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const id = useId();
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(Math.max(12, r.left + r.width / 2 - 150), window.innerWidth - 312), y: r.bottom + 8 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", () => setOpen(false), { once: true, passive: true });
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <>
      {/* The mark usually sits inside something else that is clickable — an
          indicator tile opens its series — so the event must stop here, or one
          tap on the "i" both shows the note and opens the tile behind it.
          Hover is for a mouse only: on a touch screen the browser fires a
          synthetic mouseenter just before the click, which opened the note and
          let the click immediately close it again. */}
      <button ref={btn} type="button" className="info-hint" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : show(); }}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseEnter={() => !matchMedia("(hover: none)").matches && show()}
        onMouseLeave={() => !matchMedia("(hover: none)").matches && setOpen(false)}>
        <Icon name="info" size={15} />
      </button>
      {open && createPortal(<div id={id} role="tooltip" className="tooltip glass" style={{ left: pos.x, top: pos.y }}>{children}</div>, document.body)}
    </>
  );
}

export function Modal({ open, onClose, title, children, footer, wide, sheet }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
  /** Opaque, and on a phone it keeps the grab handle. For dialogs that are
   *  mostly text: glass over a page of text is worse text, which is the same
   *  reason content surfaces in this app are opaque. */
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    // The dialog itself, not its first control. A field that is there to be
    // typed into still takes focus; otherwise focusing the close button drew a
    // focus ring on it the moment the sheet opened, which reads as "this is
    // the thing to press". The container is focusable via tabIndex={-1}, so
    // the trap and the screen-reader announcement still work.
    setTimeout(() => (ref.current?.querySelector<HTMLElement>("input, select, textarea") ?? ref.current)?.focus(), 30);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${sheet ? "is-sheet" : "glass"} ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined} ref={ref} tabIndex={-1}>
        {sheet && <span className="sheet-grip" aria-hidden="true" />}
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Zavřít"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: string; icon?: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={t.value === value} className={t.value === value ? "is-on" : ""} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={16} />}
          <span>{t.label}</span>
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone, i }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; i?: number }) {
  return (
    <div className={`stat reveal ${tone ? `tone-${tone}` : ""}`} style={{ "--i": i ?? 0 } as CSSProperties}>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max = 1, tone = "accent", label }: { value: number; max?: number; tone?: string; label?: string }) {
  const p = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className={`progress tone-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${p * 100}%` }} />
    </div>
  );
}
