import { useEffect, useLayoutEffect } from "react";
import { AssistantDrawer } from "./components/Assistant";
import { Offline } from "./components/Offline";
import { openAssistant } from "./components/assistantBus";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu } from "./components/ContextMenu";
import { Dock } from "./components/Dock";
import { Gesta } from "./components/Gesta";
import { modulBarvy } from "./components/ModuleIcon";
import { Navbar } from "./components/Navbar";
import { modulStranky, sekceStranky, TITLES } from "./components/nav";
import { Toasts } from "./components/Toasts";
import { match, useLocation } from "./lib/router";
import { Stranka } from "./pages/Stranka";

export function App() {
  const loc = useLocation();
  const m = match(loc.path);
  const bare = m.name === "hook";
  const modul = modulStranky(m.name);

  useEffect(() => {
    const t = TITLES[m.name];
    document.title = t ? `${t} · KAM` : "KAM — Krajský analytický model";
  }, [m.name]);

  // Odstín modulu pro celou aplikaci: pozadí stránky, pruh v hlavičce,
  // zvýraznění v navigaci. Před vykreslením, aby první snímek nové stránky
  // neměl barvu té předchozí.
  useLayoutEffect(() => {
    const b = modulBarvy(modul);
    const r = document.documentElement;
    r.style.setProperty("--m-a", b.a);
    r.style.setProperty("--m-b", b.b);
    r.dataset.modul = modul;
  }, [modul]);

  // Kotva musí fungovat i při prvním načtení stránky, ne až při přechodu
  // uvnitř aplikace — router scrolluje až v `commit()`, který se na startu
  // nikdy nespustí. Sekce v DOMu jsou hned, data doběhnou potom.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return;
    let pokus = 0;
    const zkus = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start" });
      else if (pokus++ < 20) requestAnimationFrame(zkus);
    };
    requestAnimationFrame(zkus);
  }, []);

  useEffect(() => {
    const open = () => openAssistant();
    window.addEventListener("kam:assistant", open);
    return () => window.removeEventListener("kam:assistant", open);
  }, []);

  const rodic = m.name === "profil" ? { label: "Obce", to: "/obce" } : undefined;

  return (
    <div className="shell">
      {!bare && <Dock />}
      {!bare && <Navbar title={TITLES[m.name] ?? ""} modul={modul} sekce={sekceStranky(m.name)} rodic={rodic} />}
      <main id="main" tabIndex={-1} className={`page page-enter ${bare ? "is-bare" : ""}`} data-page={m.name} key={m.name === "profil" ? loc.path : m.name}>
        <Stranka m={m} />
      </main>
      {!bare && <Gesta />}
      <CommandPalette />
      <ContextMenu />
      <AssistantDrawer />
      <Offline />
      <Toasts />
    </div>
  );
}
