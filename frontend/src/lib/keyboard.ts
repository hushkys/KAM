// Virtual keyboard awareness for phones.
//
// The visual viewport shrinks when the on-screen keyboard opens. We publish
// its height as --vvh (sheets and the chat size themselves to it) and set
// data-kb="open" while a text field has focus and the keyboard is up, which
// hides the dock. The focused field is scrolled into the visible area.

const TEXT = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, [contenteditable='true']";

export function initKeyboard(): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const vv = window.visualViewport;
  const update = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty("--vvh", `${Math.round(h)}px`);
    const typing = document.activeElement instanceof HTMLElement && document.activeElement.matches(TEXT);
    const shrunk = window.innerHeight - h > 120;
    if (typing && (shrunk || (matchMedia("(pointer: coarse)").matches && window.innerWidth < 720))) root.dataset.kb = "open";
    else delete root.dataset.kb;
  };
  vv?.addEventListener("resize", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", (e) => {
    update();
    const el = e.target as HTMLElement;
    if (el.matches?.(TEXT) && matchMedia("(pointer: coarse)").matches) {
      window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 280);
    }
  });
  document.addEventListener("focusout", () => window.setTimeout(update, 60));
  update();
}
