// Která stránka patří ke které adrese. Samostatně, protože ji potřebují dva:
// `App` pro skutečnou stránku a `Gesta` pro náhled sousední stránky, který
// se při přejetí prstem vysune pod ním.

import type { Match } from "../lib/router";
import { About } from "./About";
import { AssistantPage } from "./AssistantPage";
import { DataPage } from "./Data";
import { Dotace } from "./Dotace";
import { Finance } from "./Finance";
import { Hook } from "./Hook";
import { Legal } from "./Legal";
import { MapPage } from "./MapPage";
import { NotFound } from "./NotFound";
import { Outlook } from "./Outlook";
import { Overview } from "./Overview";
import { Plany } from "./Plany";
import { Profile } from "./Profile";
import { Reports } from "./Reports";
import { Scenarios } from "./Scenarios";
import { Settings } from "./Settings";
import { Stats } from "./Stats";
import { Territories } from "./Territories";

export function Stranka({ m }: { m: Match }) {
  switch (m.name) {
    case "hook": return <Hook />;
    case "prehled": return <Overview />;
    case "mapa": return <MapPage />;
    case "obce": return <Territories />;
    case "profil": return <Profile id={m.params.id} />;
    case "vyhled": return <Outlook />;
    case "scenare": return <Scenarios />;
    case "hospodareni": return <Finance />;
    case "plany": return <Plany />;
    case "dotace": return <Dotace />;
    case "podnety": return <Reports />;
    case "data": return <DataPage />;
    case "statistiky": return <Stats />;
    case "asistent": return <AssistantPage />;
    case "nastaveni": return <Settings tab={m.params.tab} />;
    case "o-nas": return <About />;
    case "pravni": return <Legal />;
    default: return <NotFound />;
  }
}
