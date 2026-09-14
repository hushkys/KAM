import { useEffect, type ReactNode } from "react";
import { AssistantDrawer } from "./components/Assistant";
import { openAssistant } from "./components/assistantBus";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu } from "./components/ContextMenu";
import { Dock } from "./components/Dock";
import { Navbar } from "./components/Navbar";
import { TITLES } from "./components/nav";
import { Toasts } from "./components/Toasts";
import { match, useLocation } from "./lib/router";
import { About } from "./pages/About";
import { AssistantPage } from "./pages/AssistantPage";
import { DataPage } from "./pages/Data";
import { Hook } from "./pages/Hook";
import { Legal } from "./pages/Legal";
import { MapPage } from "./pages/MapPage";
import { NotFound } from "./pages/NotFound";
import { Outlook } from "./pages/Outlook";
import { Overview } from "./pages/Overview";
import { Profile } from "./pages/Profile";
import { Dotace } from "./pages/Dotace";
import { Finance } from "./pages/Finance";
import { Reports } from "./pages/Reports";
import { Scenarios } from "./pages/Scenarios";
import { Settings } from "./pages/Settings";
import { Stats } from "./pages/Stats";
import { Territories } from "./pages/Territories";

export function App() {
  const loc = useLocation();
  const m = match(loc.path);
  const bare = m.name === "hook";

  useEffect(() => {
    const t = TITLES[m.name];
    document.title = t ? `${t} · KAM` : "KAM — Krajský analytický model";
  }, [m.name]);

  useEffect(() => {
    const open = () => openAssistant();
    window.addEventListener("kam:assistant", open);
    return () => window.removeEventListener("kam:assistant", open);
  }, []);

  let page: ReactNode;
  switch (m.name) {
    case "hook": page = <Hook />; break;
    case "prehled": page = <Overview />; break;
    case "mapa": page = <MapPage />; break;
    case "obce": page = <Territories />; break;
    case "profil": page = <Profile id={m.params.id} />; break;
    case "vyhled": page = <Outlook />; break;
    case "scenare": page = <Scenarios />; break;
    case "hospodareni": page = <Finance />; break;
    case "dotace": page = <Dotace />; break;
    case "podnety": page = <Reports />; break;
    case "data": page = <DataPage />; break;
    case "statistiky": page = <Stats />; break;
    case "asistent": page = <AssistantPage />; break;
    case "nastaveni": page = <Settings tab={m.params.tab} />; break;
    case "o-nas": page = <About />; break;
    case "pravni": page = <Legal />; break;
    default: page = <NotFound />;
  }

  return (
    <div className="shell">
      {!bare && <Navbar title={TITLES[m.name] ?? ""} />}
      <main id="main" tabIndex={-1} className={`page page-enter ${bare ? "is-bare" : ""}`} data-page={m.name} key={m.name === "profil" ? loc.path : m.name}>
        {page}
      </main>
      {!bare && <Dock />}
      <CommandPalette />
      <ContextMenu />
      <AssistantDrawer />
      <Toasts />
    </div>
  );
}
