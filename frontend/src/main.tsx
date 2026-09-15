import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "./styles/base.css";
import "./styles/components.css";
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
