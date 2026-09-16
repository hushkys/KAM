import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
// Jen osa WONK (34 kB na podmnožinu): dává Fraunces ty křivé patky, kvůli
// kterým se do nadpisů hooků vybrala, a přitom váží stejně jako holá váha.
import "@fontsource-variable/fraunces/wonk.css";
import "./styles/base.css";
import "./styles/components.css";
// Úvodní stránka má vlastní soubor a načítá se před `pages.css`, aby dotykový
// blok na jeho konci zůstal opravdu poslední.
import "./styles/hook.css";
import "./styles/pages.css";
import { initKeyboard } from "./lib/keyboard";
import { apply } from "./lib/prefs";
import { initPwa } from "./lib/pwa";
import { App } from "./App";

apply();
initKeyboard();
initPwa();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
