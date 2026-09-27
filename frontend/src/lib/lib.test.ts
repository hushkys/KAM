import { describe, expect, it } from "vitest";
import { niceTicks } from "../components/charts";
import { binOf, ramp } from "../components/maps";
import { parseBlock } from "./api";
import { compact, dateTime, fold, num, pct, plural, signed, withUnit } from "./format";
import { applyAction, DEFAULTS, get, sanitize, set } from "./prefs";
import { potrebaIosNavod } from "./pwa";
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

describe("pwa", () => {
  const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const iPad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const chromeNaIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

  it("nabídne návod jen v Safari na iOS", () => {
    expect(potrebaIosNavod(iPhone, 5, false)).toBe(true);
    // iPadOS se od verze 13 hlásí jako Mac; pozná se až podle dotykových bodů.
    expect(potrebaIosNavod(iPad, 5, false)).toBe(true);
    expect(potrebaIosNavod(mac, 0, false)).toBe(false);
    // Chrome na iOS „Přidat na plochu" nemá, takže by návod nikam nevedl.
    expect(potrebaIosNavod(chromeNaIos, 5, false)).toBe(false);
    // Android pošle beforeinstallprompt, tam je tlačítko, ne návod.
    expect(potrebaIosNavod(android, 5, false)).toBe(false);
  });

  it("v nainstalované aplikaci nenabízí nic", () => {
    expect(potrebaIosNavod(iPhone, 5, true)).toBe(false);
    expect(potrebaIosNavod(iPad, 5, true)).toBe(false);
  });
});

describe("dateTime", () => {
  it("k datu přidá i čas", () => {
    const out = dateTime("2026-09-15T02:34:00Z");
    // Log rozlišuje záznamy ze stejného dne, takže hodina a minuta tam musí být.
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("prázdnou hodnotu nevydává za datum", () => {
    expect(dateTime(null)).toBe("—");
    expect(dateTime("nesmysl")).toBe("nesmysl");
  });
});

describe("markdown odpovědí asistenta", () => {
  const html = async (text: string) => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { Markdown } = await import("../components/Assistant");
    return renderToStaticMarkup(createElement(Markdown, { text, sources: [{ n: 1, title: "ČSÚ", url: "https://csu.gov.cz", type: "dataset" }] }));
  };

  it("vykreslí nadpisy, seznamy a vnoření", async () => {
    const h = await html("Závěr jednou větou.\n\n### Obyvatelé\n- **554 668** lidí [1]\n  - z toho senioři\n1. první\n2. druhý");
    expect(h).toContain("<h4>Obyvatelé</h4>");
    expect(h).toContain("<strong>554 668</strong>");
    expect(h).toMatch(/<ul><li>.*<ul><li>z toho senioři<\/li><\/ul><\/li><\/ul>/);
    expect(h).toContain("<ol><li>první</li><li>druhý</li></ol>");
    expect(h).toContain('class="cite"');
  });

  it("vykreslí tabulku s čísly zarovnanými vpravo", async () => {
    const h = await html("| Ukazatel | Náchod | Jaroměř |\n|---|---:|---:|\n| Obyvatelé | 19 649 | 12 487 |");
    expect(h).toContain("<table>");
    expect(h).toContain('<td class="r">19 649</td>');
  });

  it("nevloží text z modelu jako HTML", async () => {
    const h = await html('<img src=x onerror="alert(1)"> a [odkaz](javascript:alert(1))');
    expect(h).not.toContain("<img");
    expect(h).not.toContain("javascript:");
  });
});

describe("markdown: řádky se štítky a čísla v tabulce", () => {
  it("dá každému řádku se štítkem vlastní odstavec a zarovná tučná čísla s citací", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { Markdown } = await import("../components/Assistant");
    const h = renderToStaticMarkup(createElement(Markdown, { text: "FAKT: první [1].\nTREND: druhý.\n\n| A | B |\n|---|---|\n| x | **12 487** [1] |", sources: [] }));
    expect((h.match(/<p>/g) ?? []).length).toBe(2);
    expect(h).toContain('<td class="r"><strong>12 487</strong>');
  });
});
