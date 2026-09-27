// Ctrl+K: jedno pole na všechno — území, datové sady, ukazatele, metodika,
// stránky a příkazy aplikace. Místní výsledky jsou hned, serverové doběhnou.
//
// Tři věci, na kterých tahle verze stojí:
//
//  1. **Najít se musí dát i to, co se jinak jmenuje.** Stránky a příkazy mají
//     kromě názvu i klíčová slova, takže „rozpočet" najde Hospodaření a „tma"
//     tmavý režim. Bez toho fungovalo hledání jen tomu, kdo už věděl, jak se
//     hledaná věc v aplikaci jmenuje — což je přesně ten, kdo hledat nepotřebuje.
//  2. **Kategorie jsou vidět a dají se na ně přepnout.** Deset výsledků ze čtyř
//     různých světů v jednom sloupci je seznam, ne odpověď.
//  3. **Pořadí skupin se počítá.** Skupina, ve které je nejlepší shoda, je
//     nahoře — u „Náchod" území, u „tmavý" příkazy. Uvnitř skupiny se pořadí
//     nechává tak, jak ho dal server.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { fold, num } from "../lib/format";
import { set as setPrefs } from "../lib/prefs";
import { navigate } from "../lib/router";
import { openAssistant } from "./assistantBus";
import { Icon } from "./Icon";
import { NAV } from "./nav";
import { Erb } from "./Erb";

type Kat = "uzemi" | "data" | "ukazatele" | "stranky" | "prikazy" | "asistent";

interface Hit {
  key: string; kat: Kat; group: string; title: string; sub?: string; icon: string; erb?: string;
  /** Jak dobře sedí na dotaz; řadí skupiny mezi sebou. */
  skore: number;
  run: () => void;
}

interface SearchRes {
  territories: { id: string; name: string; level_label: string; population: number; parent: string | null }[];
  datasets: { id: string; title: string; url: string; snippet: string }[];
  methods: { id: string; title: string; url: string; type: string }[];
}

const KATEGORIE: { key: Kat | "vse"; label: string }[] = [
  { key: "vse", label: "Vše" },
  { key: "uzemi", label: "Území" },
  { key: "data", label: "Data" },
  { key: "ukazatele", label: "Ukazatele" },
  { key: "stranky", label: "Stránky" },
  { key: "prikazy", label: "Příkazy" },
];

/** Slova, kterými lidé hledají to, co se v aplikaci jmenuje jinak. */
const KLICE: Record<string, string> = {
  prehled: "domů dashboard souhrn rizika puls kraj přehled začátek",
  mapa: "kartogram choropleth gis okresy orp obce území atlas",
  obce: "obec město profil srovnání porovnání seznam území orp okres katalog obcí",
  vyhled: "predikce prognóza projekce budoucnost populace stárnutí 2040 odhad trend",
  scenare: "simulace co kdyby zásah dopad modelování varianty byty školka experiment",
  hospodareni: "rozpočet finance peníze příjmy výdaje provoz investice přebytek dluh fin",
  plany: "plán rozvoje program rozvoje strategie povinně zveřejňované informace registr smluv monitor státní pokladny ičo datová schránka ares dokumenty obcepro stav plnění",
  dotace: "granty podpora výzvy dotační tituly peníze na projekty poskytovatelé",
  podnety: "hlášení stížnost problém občan participace zpětná vazba nahlásit",
  data: "otevřená data katalog datové sady zdroje export api stahování nkod csv",
  statistiky: "čísla o aplikaci metriky provoz log statistika pokrytí kvalita",
  asistent: "chat ai umělá inteligence zeptat se otázka odpověď gemini model",
  nastaveni: "předvolby motiv vzhled přístupnost soukromí modely téma písmo",
};

/** Místa mimo dock, která se taky mají dát najít. */
const MISTA: { path: string; label: string; desc: string; icon: string; klice: string }[] = [
  { path: "/o-nas", label: "O nás", desc: "Kdo aplikaci dělá a proč", icon: "users", klice: "tým autoři kdo kompaz proxis kontakt popojedem" },
  { path: "/pravni", label: "Právní informace", desc: "Podmínky, osobní údaje, licence, AI", icon: "shield", klice: "licence gdpr ochrana údajů podmínky cookies mit" },
  { path: "/nastaveni/vzhled", label: "Vzhled", desc: "Motiv, průhlednost lišt, animace, hustota", icon: "sun", klice: "tmavý světlý motiv barvy animace průhlednost navigace" },
  { path: "/nastaveni/pristupnost", label: "Přístupnost", desc: "Písmo, kontrast, pohyb, zkratky", icon: "eye", klice: "velikost písma kontrast čitelnost pohyb klávesnice" },
  { path: "/nastaveni/soukromi", label: "Data a soukromí", desc: "Co smí odejít mimo server", icon: "shield", klice: "politika ai cloud lokální uchování retence" },
  { path: "/data?tab=api", label: "Otevřené API", desc: "Všechna data ke stažení a pro vlastní aplikace", icon: "share", klice: "api rest json csv ndjson endpoint dokumentace stahování" },
];

const PRIKAZY: { title: string; icon: string; klice: string; run: () => void }[] = [
  { title: "Tmavý motiv", icon: "moon", klice: "tma noc dark motiv", run: () => setPrefs({ theme: "dark" }) },
  { title: "Světlý motiv", icon: "sun", klice: "světlo den light motiv bílá", run: () => setPrefs({ theme: "light" }) },
  { title: "Motiv podle systému", icon: "monitor", klice: "auto systém automaticky", run: () => setPrefs({ theme: "system" }) },
  { title: "Zapnout průhlednost lišt", icon: "layers", klice: "průsvitná lišta rozostření efekty", run: () => setPrefs({ transparency: true }) },
  { title: "Vypnout průhlednost lišt", icon: "layers", klice: "plná lišta efekty výkon", run: () => setPrefs({ transparency: false }) },
  { title: "Vypnout animace", icon: "motion", klice: "pohyb výkon slabý telefon zrychlit", run: () => setPrefs({ reduceMotion: true }) },
  { title: "Zapnout animace", icon: "motion", klice: "pohyb zpět", run: () => setPrefs({ reduceMotion: false }) },
  { title: "Sbalit postranní panel", icon: "sidebar", klice: "navigace jen ikony úzký menu", run: () => setPrefs({ nav: "compact" }) },
  { title: "Rozbalit postranní panel", icon: "sidebar", klice: "navigace popisky široký menu", run: () => setPrefs({ nav: "full" }) },
  { title: "Zapnout vysoký kontrast", icon: "contrast", klice: "čitelnost přístupnost", run: () => setPrefs({ contrast: "high" }) },
  { title: "Hustší rozvržení", icon: "sliders", klice: "mezery hustě víc obsahu", run: () => setPrefs({ density: "compact" }) },
  { title: "Běžné rozvržení", icon: "sliders", klice: "mezery vzdušně vzdušné pohodlné výchozí hustota", run: () => setPrefs({ density: "comfortable" }) },
  { title: "Otevřít asistenta", icon: "sparkle", klice: "chat ai zeptat", run: () => openAssistant() },
];

/** Shoda názvu s dotazem. Přesný název je víc než začátek slova a ten zase víc
 *  než kus někde uprostřed — jinak by „data" vyhrála delší věta, která to slovo
 *  má náhodou v popisu. */
function shoda(nazev: string, klice: string, f: string): number {
  if (!f) return 0.5;
  const n = fold(nazev);
  if (n === f) return 1;
  if (n.startsWith(f)) return 0.92;
  if (n.split(/\s+/).some((w) => w.startsWith(f))) return 0.82;
  if (n.includes(f)) return 0.66;
  const k = fold(klice);
  if (k.split(/\s+/).some((w) => w.startsWith(f))) return 0.78;
  if (k.includes(f)) return 0.6;
  return 0;
}

/** Přirážka pro místa a příkazy v téhle aplikaci.
 *
 *  Pole na hledání je především navigace: kdo napíše „rozpočet", chce
 *  nejspíš stránku Hospodaření, ne cizí datovou sadu, která to slovo má
 *  náhodou v názvu. Přirážka je malá schválně — přesná shoda v názvu sady
 *  pořád přebije klíčové slovo stránky. */
const DOMA = 0.15;

/** Zvýraznění shody v názvu. Bez diakritiky se hledá, s diakritikou ukazuje,
 *  takže se pozice musí najít ve složeném tvaru a vyříznout z původního —
 *  `fold` mění jen znaky, ne jejich počet, takže indexy sedí. */
function Zvyraznene({ text, f }: { text: string; f: string }) {
  if (!f) return <>{text}</>;
  const i = fold(text).indexOf(f);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + f.length)}</mark>{text.slice(i + f.length)}</>;
}

/** Zvýraznění řádku putuje, ne přeskakuje.
 *
 *  Stejný trik jako v docku: dvě tělesa ve vrstvě s goo filtrem, to zadní
 *  pomalejší, takže se mezi nimi cestou natáhne krk. Jedno klouzající obdélníkové
 *  pole umí jenom jet. */
function useMorf(active: number, pocet: number, list: React.RefObject<HTMLDivElement | null>) {
  const pill = useRef<HTMLSpanElement>(null);
  const trail = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const bezi = useRef<Animation[]>([]);
  const pokus = useRef(0);

  const [tik, setTik] = useState(0);
  useLayoutEffect(() => {
    const box = list.current, lead = pill.current, tail = trail.current;
    if (!box || !lead || !tail) return;
    const vrstva = lead.parentElement as HTMLElement;
    const radek = box.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!radek) {
      // Řádek ještě nemusí být v DOMu (první otevření, doběhlé hledání).
      // Zkusit to za snímek je rozdíl mezi „ještě ne" a „nikdy".
      vrstva.dataset.prazdno = "ano"; last.current = null;
      if (pokus.current < 5) { pokus.current += 1; requestAnimationFrame(() => setTik((t) => t + 1)); }
      return;
    }
    pokus.current = 0;

    const cil = { x: radek.offsetLeft, y: radek.offsetTop, w: radek.offsetWidth, h: radek.offsetHeight };
    const prev = last.current;
    for (const a of bezi.current) { try { a.cancel(); } catch { /* už doběhla */ } }
    bezi.current = [];

    // Zaparkovat napřed: na tyhle hodnoty animace dosedne, takže zrušení
    // doběhlého `fill: forwards` nespadne na jiný stav.
    const zaparkuj = (el: HTMLElement) => {
      el.style.width = `${cil.w}px`; el.style.height = `${cil.h}px`;
      el.style.transform = `translate(${cil.x}px, ${cil.y}px)`;
    };
    vrstva.dataset.prazdno = "ne";
    zaparkuj(lead); zaparkuj(tail);

    const tichy = document.documentElement.dataset.motion === "reduce";
    if (!prev || tichy || Math.abs(cil.y - prev.y) < 0.5) { last.current = cil; return; }

    const drah = Math.abs(cil.y - prev.y);
    const tah = Math.min(1.5, 1 + drah / 150);
    const snimky = (roztah: number): Keyframe[] => [
      { transform: `translate(${prev.x}px, ${prev.y}px) scaleY(1)`, height: `${prev.h}px` },
      { transform: `translate(${cil.x}px, ${(prev.y + cil.y) / 2}px) scaleY(${roztah})`, height: `${(prev.h + cil.h) / 2}px`, offset: 0.45 },
      { transform: `translate(${cil.x}px, ${cil.y}px) scaleY(1)`, height: `${cil.h}px` },
    ];
    const pust = (el: HTMLElement, kf: Keyframe[], ms: number) => {
      const a = el.animate(kf, { duration: ms, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      a.finished.then(() => a.cancel()).catch(() => { /* přebito */ });
      bezi.current.push(a);
    };
    pust(lead, snimky(tah), 280);
    pust(tail, snimky(1), 420);
    last.current = cil;
  }, [active, pocet, tik, list]);

  return { pill, trail };
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchRes | null>(null);
  const [cekam, setCekam] = useState(false);
  const [kat, setKat] = useState<Kat | "vse">("vse");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, [contenteditable='true']");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setOpen(true); }
    };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("kam:palette", ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("kam:palette", ev); };
  }, []);

  useEffect(() => {
    if (open) { setQ(""); setRemote(null); setKat("vse"); setActive(0); setTimeout(() => input.current?.focus(), 20); }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setRemote(null); setCekam(false); return; }
    const ctrl = new AbortController();
    setCekam(true);
    const t = setTimeout(() => {
      api<SearchRes>(`/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, timeout: 8000 })
        .then((r) => { setRemote(r); setCekam(false); })
        .catch(() => setCekam(false));
    }, 140);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const vse = useMemo<Hit[]>(() => {
    const f = fold(q.trim());
    const out: Hit[] = [];

    for (const p of NAV) {
      const s = shoda(p.label, `${p.desc} ${KLICE[p.module] ?? ""}`, f);
      if (f && s === 0) continue;
      out.push({ key: `p${p.path}`, kat: "stranky", group: "Stránky", title: p.label, sub: p.desc, icon: p.icon, skore: s + DOMA, run: () => navigate(p.path) });
    }
    for (const m of MISTA) {
      const s = shoda(m.label, `${m.desc} ${m.klice}`, f);
      if (!f || s === 0) continue;   // bez dotazu stačí dock, ať není seznam dvacet položek
      out.push({ key: `m${m.path}`, kat: "stranky", group: "Stránky", title: m.label, sub: m.desc, icon: m.icon, skore: s + DOMA, run: () => navigate(m.path) });
    }

    if (remote) {
      remote.territories.forEach((t, i) => out.push({
        key: t.id, kat: "uzemi", group: "Území", title: t.name,
        sub: `${t.level_label}${t.parent ? ` · ${t.parent}` : ""} · ${num(t.population)} obyv.`,
        icon: "pin", erb: t.id, skore: shoda(t.name, "", f) + Math.max(0, 0.08 - i * 0.008), run: () => navigate(`/obce/${t.id}`),
      }));
      remote.datasets.forEach((d, i) => out.push({
        key: `d${d.id}`, kat: "data", group: "Datové sady", title: d.title, sub: d.snippet, icon: "database",
        // Podlaha drží ve výsledcích i sadu, kterou našel fulltext v popisu,
        // ale pod těmi, které hledané slovo mají rovnou v názvu.
        skore: Math.max(shoda(d.title, "", f), 0.34 - i * 0.01), run: () => window.open(d.url, "_blank", "noopener"),
      }));
      remote.methods.forEach((m, i) => {
        const ukazatel = m.type !== "method";
        out.push({
          key: `k${m.id}`, kat: ukazatel ? "ukazatele" : "data",
          group: ukazatel ? "Ukazatele" : "Metodika a nápověda", title: m.title, icon: ukazatel ? "chart" : "book",
          skore: Math.max(shoda(m.title, "", f), 0.42 - i * 0.01),
          run: () => (m.url.startsWith("/") ? navigate(m.url) : window.open(m.url, "_blank", "noopener")),
        });
      });
    }

    for (const c of PRIKAZY) {
      const s = shoda(c.title, c.klice, f);
      if (f && s === 0) continue;
      out.push({ key: `c${c.title}`, kat: "prikazy", group: "Příkazy", title: c.title, icon: c.icon, skore: s + DOMA, run: c.run });
    }

    if (f.length > 1) {
      out.push({
        key: "ask", kat: "asistent", group: "Asistent", title: `Zeptat se: „${q.trim()}"`,
        sub: "Odpoví z dat aplikace a uvede zdroj", icon: "sparkle", skore: 0.05, run: () => openAssistant(q.trim()),
      });
    }
    return out;
  }, [q, remote]);

  /** Skupiny v pořadí podle nejlepší shody uvnitř nich; uvnitř zůstává pořadí,
   *  v jakém položky přišly. Bez dotazu je pořadí dané, ne spočítané. */
  const skupiny = useMemo(() => {
    const vybrane = kat === "vse" ? vse : vse.filter((h) => h.kat === kat || h.kat === "asistent");
    const mapa = new Map<string, Hit[]>();
    for (const h of vybrane) (mapa.get(h.group) ?? mapa.set(h.group, []).get(h.group)!).push(h);
    const poradi = [...mapa.entries()].map(([nazev, polozky]) => ({
      nazev, polozky,
      top: polozky[0]?.kat === "asistent" ? -1 : Math.max(...polozky.map((p) => p.skore)),
    }));
    poradi.sort((a, b) => b.top - a.top);
    // Strop na skupinu: deset obcí pod sebou pohřbí všechno ostatní.
    const strop = kat !== "vse" ? 24 : vybrane.some((h) => h.kat === "uzemi" || h.kat === "data") ? 5 : 12;
    return poradi.map((s) => ({ ...s, polozky: s.polozky.slice(0, strop), vic: Math.max(0, s.polozky.length - strop) }));
  }, [vse, kat]);

  const ploche = useMemo(() => skupiny.flatMap((s) => s.polozky), [skupiny]);
  const pocty = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of vse) if (h.kat !== "asistent") m.set(h.kat, (m.get(h.kat) ?? 0) + 1);
    return m;
  }, [vse]);

  const dostupne = useMemo(() => KATEGORIE.filter((k) => k.key === "vse" || (pocty.get(k.key) ?? 0) > 0), [pocty]);
  const morf = useMorf(active, ploche.length, list);

  useEffect(() => setActive(0), [ploche.length, kat]);
  useEffect(() => { list.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }); }, [active]);
  // Zmizí-li kategorie s dotazem (bylo v ní jen to, co už neodpovídá), filtr by
  // jinak zůstal viset na prázdnu a seznam by vypadal, že nic nenašel.
  useEffect(() => { if (kat !== "vse" && !(pocty.get(kat) ?? 0)) setKat("vse"); }, [kat, pocty]);

  if (!open) return null;
  const f = fold(q.trim());
  const pick = (h: Hit) => { setOpen(false); h.run(); };
  const posunKategorii = (o: number) => {
    const i = dostupne.findIndex((k) => k.key === kat);
    const dalsi = dostupne[Math.min(dostupne.length - 1, Math.max(0, i + o))];
    if (dalsi) setKat(dalsi.key);
  };

  let ix = -1;
  return createPortal(
    <div className="palette-layer" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      {/* Vlastní goo, ne ten z docku: na úvodní stránce dock není a filtr by
          v DOMu chyběl — zvýraznění by se přestalo slévat bez varování. */}
      <svg className="goo-defs" aria-hidden="true" focusable="false">
        <filter id="palette-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
        </filter>
      </svg>

      <div className="palette glass" role="dialog" aria-modal="true" aria-label="Hledat">
        <div className="palette-input">
          <Icon name="search" size={19} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat obec, datovou sadu, ukazatel nebo stránku…" aria-label="Hledat v aplikaci"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={ploche[active] ? `ph-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(ploche.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "ArrowRight" && !e.currentTarget.value.slice(e.currentTarget.selectionStart ?? 0).length) { e.preventDefault(); posunKategorii(1); }
              else if (e.key === "ArrowLeft" && !e.currentTarget.selectionStart) { e.preventDefault(); posunKategorii(-1); }
              else if (e.key === "Enter" && ploche[active]) pick(ploche[active]);
              else if (e.key === "Escape") setOpen(false);
            }} />
          {cekam && <span className="palette-cekam" aria-hidden="true" />}
          {q && <button className="icon-btn sm" aria-label="Vymazat hledání" onClick={() => { setQ(""); input.current?.focus(); }}><Icon name="close" size={15} /></button>}
          <kbd className="jen-mys">Esc</kbd>
        </div>

        {dostupne.length > 1 && (
          <div className="palette-katy" role="tablist" aria-label="Kategorie výsledků">
            {dostupne.map((k) => (
              <button key={k.key} role="tab" aria-selected={kat === k.key} className={`pk-chip ${kat === k.key ? "je-on" : ""}`} onClick={() => setKat(k.key)}>
                {k.label}
                {k.key !== "vse" && <span className="pk-pocet">{pocty.get(k.key)}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {/* `data-prazdno` se schválně nerenderuje: kdyby ho React vlastnil,
              každé překreslení by ho vrátilo na výchozí a zvýraznění by zmizelo. */}
          <span className="palette-morf" aria-hidden="true">
            <span className="pm-pill pm-trail" ref={morf.trail} />
            <span className="pm-pill" ref={morf.pill} />
          </span>
          {skupiny.map((s) => (
            <div className="palette-sekce" key={s.nazev}>
              <div className="palette-group">{s.nazev}<span>{s.polozky.length + s.vic}</span></div>
              {s.polozky.map((h) => {
                ix += 1;
                const i = ix;
                return (
                  <button key={h.key} id={`ph-${i}`} data-i={i} role="option" aria-selected={i === active}
                    className={`palette-item ${i === active ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                    {h.erb ? <Erb id={h.erb} name={h.title} size={26} className="pi-erb" /> : <span className="pi-icon"><Icon name={h.icon} size={15} /></span>}
                    <span className="pi-text">
                      <span className="pi-title"><Zvyraznene text={h.title} f={f} /></span>
                      {h.sub && <span className="pi-sub">{h.sub}</span>}
                    </span>
                    <Icon name="arrow-right" size={14} />
                  </button>
                );
              })}
              {s.vic > 0 && (
                <button className="palette-vic" onClick={() => setKat(s.polozky[0].kat)}>
                  Zobrazit všechny výsledky ({s.polozky.length + s.vic})
                </button>
              )}
            </div>
          ))}
          {!ploche.length && (
            <div className="empty">
              <strong>Nic jsme nenašli</strong>
              <span className="small muted">Zkuste jiné slovo, nebo otázku napište asistentovi.</span>
            </div>
          )}
        </div>

        <div className="palette-foot jen-mys">
          <span><kbd>↑</kbd><kbd>↓</kbd> výběr</span>
          <span><kbd>←</kbd><kbd>→</kbd> kategorie</span>
          <span><kbd>Enter</kbd> otevřít</span>
          <span className="palette-foot-konec"><kbd>Ctrl</kbd>+<kbd>J</kbd> asistent</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
