import { Link } from "../lib/router";
import { resolvedTheme, set as setPrefs, usePrefs } from "../lib/prefs";
import { toggleAssistant, useAssistantState } from "./assistantBus";
import { Icon } from "./Icon";
import { Wordmark } from "./Logo";
import { Notifications } from "./Notifications";

export function Navbar({ title }: { title: string }) {
  const prefs = usePrefs();
  const dark = resolvedTheme(prefs) === "dark";
  const assistant = useAssistantState();
  return (
    <header className="navbar glass" role="banner">
      <Link to="/" className="navbar-brand" aria-label="KAM — úvodní stránka">
        <Wordmark style={{ height: 19 }} />
        <span className="navbar-divider" aria-hidden="true" />
        <span className="navbar-title">{title}</span>
      </Link>
      <span className="navbar-spacer" />
      <button className="navbar-search" onClick={() => window.dispatchEvent(new CustomEvent("kam:palette"))} aria-label="Hledat (Ctrl+K)">
        <Icon name="search" />
        <span>Hledat obec, data, stránku…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <nav className="navbar-actions" aria-label="Rychlé akce">
        <button className={`icon-btn ${assistant.open ? "is-on" : ""}`} onClick={toggleAssistant} aria-label="Asistent (Ctrl+J)" aria-pressed={assistant.open} title="Asistent (Ctrl+J)">
          <Icon name="sparkle" size={19} />
        </button>
        <Notifications />
        <button className="icon-btn hide-sm" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Přepnout na světlý režim" : "Přepnout na tmavý režim"} title={dark ? "Světlý režim" : "Tmavý režim"}>
          <Icon name={dark ? "sun" : "moon"} size={19} />
        </button>
        <Link to="/nastaveni" className="icon-btn" aria-label="Nastavení" title="Nastavení"><Icon name="settings" size={19} /></Link>
      </nav>
    </header>
  );
}
