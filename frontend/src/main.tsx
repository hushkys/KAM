import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Figtree: přátelské, otevřené geometrické písmo s plynulou osou tloušťky.
// Jedno písmo pro celou aplikaci; pokrývá latin-ext, takže háčky a kroužky
// jsou z téhož písma, ne z náhradního.
import "@fontsource-variable/figtree/wght.css";
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
