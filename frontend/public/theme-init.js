// Runs before the first paint so a dark-mode user never sees a white flash.
// Mirrors apply() in src/lib/prefs.ts — keep the two in step.
(function () {
  var p = {};
  try { p = JSON.parse(localStorage.getItem("kam.prefs") || "{}") || {}; } catch (e) { p = {}; }
  var r = document.documentElement;
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var theme = p.theme || "dark";
  if (theme === "system") theme = mq("(prefers-color-scheme: dark)") ? "dark" : "light";
  r.setAttribute("data-theme", theme);
  r.setAttribute("data-transparency", p.transparency === false ? "off" : "on");
  r.setAttribute("data-motion", p.reduceMotion || mq("(prefers-reduced-motion: reduce)") ? "reduce" : "full");
  r.setAttribute("data-contrast", p.contrast === "high" ? "high" : "normal");
  r.setAttribute("data-density", p.density === "compact" ? "compact" : "comfortable");
  r.setAttribute("data-dock", p.dock === "side" ? "side" : "bottom");
  r.setAttribute("data-dock-labels", p.dockLabels === false ? "off" : "on");
  r.setAttribute("data-underline", p.underlineLinks ? "on" : "off");
  r.setAttribute("data-focus", p.focusRing ? "strong" : "normal");
  if (p.fontScale) r.style.setProperty("--font-scale", String(p.fontScale));
  r.style.colorScheme = theme;
})();
