import { describe, expect, it } from "vitest";
import { niceTicks } from "../components/charts";
import { binOf, ramp } from "../components/maps";
import { parseBlock } from "./api";
import { compact, fold, num, pct, plural, signed, withUnit } from "./format";
import { applyAction, DEFAULTS, get, sanitize, set } from "./prefs";
import { match } from "./router";

describe("format", () => {
  it("formats Czech numbers", () => {
    expect(num(554668).replace(/\s/g, " ")).toBe("554 668");
    expect(num(20.83)).toBe("20,8");
    expect(num(0.4215)).toBe("0,42");
    expect(num(null)).toBe("—");
    expect(pct(22.8)).toBe("22,8 %");
    expect(signed(-1.5, 1)).toBe("−1,5");
    expect(signed(2, 0, " %")).toBe("+2 %");
    expect(compact(15489000)).toBe("15,5 mil.");
    expect(withUnit(1, "ano/ne")).toBe("ano");
  });
  it("picks Czech plural forms", () => {
    expect(plural(1, "sada", "sady", "sad")).toBe("sada");
    expect(plural(3, "sada", "sady", "sad")).toBe("sady");
    expect(plural(5, "sada", "sady", "sad")).toBe("sad");
  });
  it("folds diacritics", () => {
    expect(fold("Hradec Králové")).toBe("hradec kralove");
  });
});

describe("router", () => {
  it("matches routes and params", () => {
    expect(match("/").name).toBe("hook");
    expect(match("/obce/obec:574121")).toEqual({ name: "profil", params: { id: "obec:574121" } });
    expect(match("/nastaveni/modely").params.tab).toBe("modely");
    expect(match("/obce/../../etc").name).toBe("404");
  });
});

describe("prefs", () => {
  it("sanitizes stored values", () => {
    const p = sanitize({ ...DEFAULTS, theme: "neon" as never, fontScale: 9 });
    expect(p.theme).toBe(DEFAULTS.theme);
    expect(p.fontScale).toBe(1.3);
  });
  it("applies assistant actions", () => {
    set({ ...DEFAULTS });
    applyAction("theme", "light");
    expect(get().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyAction("fontScale", "up");
    expect(get().fontScale).toBeCloseTo(1.1);
    applyAction("transparency", false);
    expect(document.documentElement.dataset.transparency).toBe("off");
    expect(applyAction("nonsense", 1)).toBeNull();
  });
});

describe("sse", () => {
  it("parses an event block", () => {
    expect(parseBlock('event: token\ndata: {"text":"Ahoj"}')).toEqual({ event: "token", data: { text: "Ahoj" } });
  });
});

describe("charts and maps", () => {
  it("makes round axis ticks", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(541000, 557000, 4)[0]).toBe(540000);
  });
  it("bins values by quantile breaks", () => {
    expect(binOf(1, [2, 4, 6, 8])).toBe(0);
    expect(binOf(5, [2, 4, 6, 8])).toBe(2);
    expect(binOf(99, [2, 4, 6, 8])).toBe(4);
    expect(ramp(-1, "dark")).toHaveLength(5);
    expect(ramp(1, "light")[0]).not.toBe(ramp(-1, "light")[0]);
  });
});
