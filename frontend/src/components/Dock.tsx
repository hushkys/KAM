// Navigace aplikace: postranní panel na počítači a tabletu, spodní lišta na
// telefonu. Obojí je vykreslené vždycky a co je vidět, rozhoduje CSS podle
// šířky okna — skrytá varianta má `display: none`, takže ji čtečka ani
// klávesnice nevidí a v přístupnostním stromu je navigace jen jednou.
//
// Zvýraznění aktivní položky je jeden prvek, který se posouvá, ne pozadí
// každé položky zvlášť. Kdyby měly pozadí položky, objevilo by se dvakrát.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useApi } from "../lib/api";
import { date } from "../lib/format";
import { Link, useLocation } from "../lib/router";
import { set as setPrefs, usePrefs } from "../lib/prefs";
import { Icon } from "./Icon";
import { Mark, Wordmark } from "./Logo";
import { ModuleIcon } from "./ModuleIcon";
import { NAV, SEKCE, type Sekce } from "./nav";
import { Modal } from "./ui";

/** Co otevře „Více" na telefonu. Stránky se berou z NAV, aby místo přidané
 *  tam nemohlo tady chybět. */
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

/** Posune zvýraznění na aktivní položku.
 *
 *  Poloha se měří z `offsetTop`/`offsetLeft`, tedy vůči seznamu, ve kterém
 *  zvýraznění bydlí — posouvá se s ním, když se panel roluje, a nic se
 *  nezapočítá dvakrát. Při prvním umístění se přechod vypne, jinak by
 *  zvýraznění po načtení stránky přijelo odněkud z rohu. */
function useZvyrazneni(path: string, osa: "y" | "x") {
  const seznam = useRef<HTMLElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const prvni = useRef(true);

  useLayoutEffect(() => {
    const umisti = () => {
      const box = seznam.current, el = ind.current;
      if (!box || !el) return;
      const aktivni = box.querySelector<HTMLElement>('[aria-current="page"]');
      if (!aktivni || !aktivni.offsetWidth) { el.dataset.prazdno = "ano"; return; }
      el.dataset.prazdno = "ne";
      if (prvni.current) el.style.transition = "none";
      if (osa === "y") {
        el.style.setProperty("--y", `${aktivni.offsetTop}px`);
        el.style.height = `${aktivni.offsetHeight}px`;
      } else {
        const w = Math.min(36, aktivni.offsetWidth * 0.5);
        el.style.setProperty("--x", `${aktivni.offsetLeft + (aktivni.offsetWidth - w) / 2}px`);
        el.style.width = `${w}px`;
      }
      if (prvni.current) {
        prvni.current = false;
        requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ""; }));
      }
    };
    umisti();
    const ro = new ResizeObserver(umisti);
    if (seznam.current) ro.observe(seznam.current);
    document.fonts?.ready.then(umisti).catch(() => { /* bez webfontu */ });
    return () => ro.disconnect();
  }, [path, osa]);

  return { seznam, ind };
}

const PORADI: Sekce[] = ["analyza", "obec", "verejnost", "system"];

export function Dock() {
  const { path } = useLocation();
  const prefs = usePrefs();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const current = (p: string) => path === p || path.startsWith(`${p}/`);
  const extraActive = NAV.some((n) => n.extra && current(n.path));
  // Sbalený panel změní svislé polohy položek (nadpisy skupin se smrsknou na
  // linku) okamžitě, zatímco šířka se teprve animuje — zvýraznění se proto
  // přeměří i při změně předvolby, ne až při změně velikosti.
  const panel = useZvyrazneni(`${path}|${prefs.nav}`, "y");
  const lista = useZvyrazneni(`${path}${extraActive ? "#vic" : ""}`, "x");
  const sbaleny = prefs.nav === "compact";

  return (
    <>
      <aside className="sidebar" aria-label="Hlavní navigace">
        <Link to="/" className="sb-brand" aria-label="KAM — úvodní stránka">
          <span className="sb-mark"><Mark size={30} /></span>
          <Wordmark />
          <span className="sb-brand-text">
            <b>Krajský analytický model</b>
            <span>Královéhradecký kraj</span>
          </span>
        </Link>
        <nav className="sb-nav" ref={panel.seznam as React.RefObject<HTMLElement>}>
          <span className="sb-ind" ref={panel.ind} data-prazdno="ano" aria-hidden="true" />
          {PORADI.map((s) => {
            const polozky = NAV.filter((n) => n.sekce === s && n.module !== "nastaveni");
            if (!polozky.length) return null;
            return (
              <Fragment key={s}>
                <div className="sb-group" role="presentation">{SEKCE[s]}</div>
                {polozky.map((n) => (
                  <Link key={n.path} to={n.path} className="sb-item" aria-current={current(n.path) ? "page" : undefined} title={`${n.label} — ${n.desc}`}>
                    <ModuleIcon name={n.module} size={20} />
                    <span className="sb-label">{n.label}</span>
                  </Link>
                ))}
              </Fragment>
            );
          })}
          <div className="sb-group" role="presentation">Aplikace</div>
          <Link to="/nastaveni" className="sb-item" aria-current={current("/nastaveni") ? "page" : undefined} title="Nastavení — vzhled, přístupnost, modely, data a soukromí">
            <ModuleIcon name="nastaveni" size={20} />
            <span className="sb-label">Nastavení</span>
          </Link>
          <Link to="/o-nas" className="sb-item" aria-current={current("/o-nas") ? "page" : undefined} title="O nás — tým Popojedem. a projekt KAM">
            <ModuleIcon name="onas" size={20} />
            <span className="sb-label">O nás</span>
          </Link>
        </nav>
        <div className="sb-foot">
          <Cerstvost />
          <button type="button" className="sb-item sb-sbalit" onClick={() => setPrefs({ nav: sbaleny ? "full" : "compact" })}
            aria-label={sbaleny ? "Rozbalit postranní panel" : "Sbalit postranní panel"} title={sbaleny ? "Rozbalit panel" : "Sbalit panel na ikony"}>
            <Icon name="chevron-left" size={18} />
            <span className="sb-label">Sbalit panel</span>
          </button>
        </div>
      </aside>

      <nav className="tabbar" aria-label="Hlavní navigace" ref={lista.seznam as React.RefObject<HTMLElement>}>
        <span className="tb-ind" ref={lista.ind} data-prazdno="ano" aria-hidden="true" />
        {NAV.filter((n) => !n.extra).map((n) => (
          <Link key={n.path} to={n.path} className="tb-item" aria-current={current(n.path) ? "page" : undefined}>
            <ModuleIcon name={n.module} size={24} />
            <span className="tb-label">{n.label}</span>
          </Link>
        ))}
        <button type="button" className="tb-item" aria-current={extraActive ? "page" : undefined} aria-expanded={more} onClick={() => setMore(true)}>
          <Icon name="grid" size={24} />
          <span className="tb-label">Více</span>
        </button>
      </nav>

      {/* Řádky, ne mřížka čtverců: dva sloupce dlaždic zalomí popisy do různé
          výšky, nic nelícuje a oko nemá po čem jet dolů. Řádek přes celou
          šířku se dá přečíst a je to cíl široký jako obrazovka. */}
      <Modal open={more} onClose={() => setMore(false)} title="Další" sheet>
        <div className="more-list">
          {MORE_SECTIONS.map((section) => (
            <Fragment key={section.title}>
              <h3 className="more-group">{section.title}</h3>
              {section.items.map((n) => (
                <Link key={n.path} to={n.path} className="more-row" aria-current={current(n.path) ? "page" : undefined}>
                  <span className="more-icon"><ModuleIcon name={n.module} size={24} /></span>
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

/** Jak čerstvá jsou data, na každé stránce. Úřední statistika vychází po
 *  letech, takže „živá“ data tu neexistují; poctivé je říct, kdy se naposledy
 *  obnovovala a za jaký rok ČSÚ údaje vydal. Tečka zežloutne, když obnova
 *  neproběhla přes tři dny — to už je porucha, ne rytmus zdroje. */
function Cerstvost() {
  const { data } = useApi<{ obnoveno: string | null; hodnoty_zapsany: string | null; odkazy_overeny: string | null; rok_statistik: number | null }>("/aktualnost");
  if (!data) return null;
  const kdy = data.obnoveno ?? data.hodnoty_zapsany;
  const stare = !kdy || Date.now() - new Date(kdy).getTime() > 3 * 864e5;
  const radek1 = data.obnoveno ? `Obnoveno ${date(data.obnoveno)}` : kdy ? `Sklizeno ${date(kdy)}` : "Data zatím neobnovena";
  const radek2 = data.rok_statistik ? `Statistiky ČSÚ za rok ${data.rok_statistik}` : "";
  return (
    <Link to="/statistiky" className={`sb-cerstvost${stare ? " je-stare" : ""}`} title={`${radek1}${radek2 ? ` · ${radek2}` : ""}${data.odkazy_overeny ? ` · odkazy ověřeny ${date(data.odkazy_overeny)}` : ""}`}>
      <i aria-hidden="true" />
      <span className="sb-label"><b>{radek1}</b>{radek2 && <span>{radek2}</span>}</span>
    </Link>
  );
}
