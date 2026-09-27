// Horní lišta: kde jsem (odstín a ikona modulu, sekce, název), hledání a pár
// akcí. Značka je v postranním panelu; na telefonu, kde panel není, se
// vrací sem.

import { Link } from "../lib/router";
import { resolvedTheme, set as setPrefs, usePrefs } from "../lib/prefs";
import { toggleAssistant, useAssistantState } from "./assistantBus";
import { Icon } from "./Icon";
import { Wordmark } from "./Logo";
import { ModuleIcon } from "./ModuleIcon";
import { Notifications } from "./Notifications";

export function Navbar({ title, modul, sekce, rodic }: { title: string; modul: string; sekce?: string; rodic?: { label: string; to: string } }) {
  const prefs = usePrefs();
  const dark = resolvedTheme(prefs) === "dark";
  const assistant = useAssistantState();
  return (
    <header className="navbar" role="banner">
      <Link to="/" className="navbar-brand" aria-label="KAM — úvodní stránka">
        <Wordmark />
      </Link>
      <div className="navbar-place">
        <ModuleIcon name={modul} size={22} />
        {(rodic || sekce) && (
          <span className="navbar-crumb">
            {rodic ? <Link to={rodic.to}>{rodic.label}</Link> : <span>{sekce}</span>}
            <span className="sep" aria-hidden="true">/</span>
          </span>
        )}
        <span className="navbar-title">{title}</span>
      </div>
      <span className="navbar-spacer" />
      <button className="navbar-search" onClick={() => window.dispatchEvent(new CustomEvent("kam:palette"))} aria-label="Hledat (Ctrl+K)">
        <Icon name="search" />
        <span>Hledat obec, data, stránku…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <nav className="navbar-actions" aria-label="Rychlé akce">
        <button data-assistant-toggle className={`icon-btn ${assistant.open ? "is-on" : ""}`} onClick={toggleAssistant} aria-label="Asistent (Ctrl+J)" aria-pressed={assistant.open} title="Zeptat se asistenta (Ctrl+J)">
          <Icon name="sparkle" size={18} />
        </button>
        <Notifications />
        <button className="icon-btn hide-sm" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Přepnout na světlý motiv" : "Přepnout na tmavý motiv"} title={dark ? "Světlý motiv" : "Tmavý motiv"}>
          <Icon name={dark ? "sun" : "moon"} size={18} />
        </button>
        <Link to="/nastaveni" className="icon-btn hide-sm" aria-label="Nastavení" title="Nastavení"><Icon name="settings" size={18} /></Link>
      </nav>
    </header>
  );
}
