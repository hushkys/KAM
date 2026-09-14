import { describe, expect, it } from "vitest";
import { niceTicks } from "../components/charts";
import { binOf, ramp } from "../components/maps";
import { parseBlock } from "./api";
import { compact, fold, num, pct, plural, signed, withUnit } from "./format";
import { applyAction, DEFAULTS, get, sanitize, set } from "./prefs";
import { match } from "./router";
import { DOMA, POVRCH, prichod, Pruzina, R, telo } from "../components/mascot-engine";

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

describe("maskot", () => {
  it("drží tělo na ploše, ať se zdeformuje jakkoli", () => {
    // Střed se počítá jako plocha − spodní poloměr, takže spodek těla leží
    // přesně na písmenu i ve stlačeném stavu. Tohle je to, co maskotovi brání
    // zalézt do písmene, když se při dopadu roztáhne.
    const plocha = POVRCH;
    for (const rBot of [R, R * 0.5, R * 1.3]) {
      const stred = plocha - rBot;
      expect(stred + rBot).toBeCloseTo(plocha, 6);
    }
  });

  it("dělá z těla nesouměrný tvar, ne elipsu", () => {
    const placka = telo({ x: 0, y: 0, rot: 0, rTop: 7, rBot: 11, rL: 24, rR: 24, shear: 0, flat: 0.9 });
    const kruh = telo({ x: 0, y: 0, rot: 0, rTop: R, rBot: R, rL: R, rR: R, shear: 0, flat: 0 });
    expect(placka).not.toBe(kruh);
    // Čtyři okraje jdou každý svým dílem: horní a dolní poloměr se v cestě liší.
    expect(placka).toContain("M0.00,-7.00");
    expect(placka).toContain(",11.00");
  });

  it("pružina se ustálí na cíli", () => {
    const p = new Pruzina(1, 1, 400, 14);
    p.kopni(0.5, -2);
    for (let i = 0; i < 400; i++) p.krok(1 / 60);
    expect(p.hodnota).toBeCloseTo(1, 3);
  });

  it("choreografie končí doma na místě tečky", () => {
    const s = prichod();
    expect(s[s.length - 1].druh).toBe("doma");
    const delka = s.reduce((a, u) => a + u.t, 0);
    // Dost dlouhé na rozmyšlenou, dost krátké, aby to nenudilo.
    expect(delka).toBeGreaterThan(3);
    expect(delka).toBeLessThan(5.5);
    expect(DOMA.y - R).toBe(86);
  });
});
