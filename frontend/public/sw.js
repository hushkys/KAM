// Service worker: aplikace se musí otevřít i ve vlaku mezi Trutnovem a Hradcem.
//
// Není generovaný build krokem a nemá seznam souborů k předběžnému uložení.
// Důvod je praktický: názvy sestavených souborů nesou otisk obsahu, takže
// seznam by se musel po každém buildu přepisovat a jednou by se to zapomnělo.
// Místo toho se ukládá za běhu — po první návštěvě je v mezipaměti skořápka
// i všechny soubory, které si stránka vyžádala.
//
// Strategie podle druhu požadavku:
//   navigace   → nejdřív síť (a krátký časový strop), jinak uložená skořápka
//   /assets/*  → nejdřív mezipaměť; jméno nese otisk obsahu, takže se nemění
//   /api/* GET → nejdřív síť bez stropu, při skutečném výpadku poslední známá odpověď
//   ostatní    → z mezipaměti a na pozadí se obnoví
//
// Čísla z mezipaměti jsou pořád čísla z databáze, jen starší — proto aplikace
// v offline režimu zobrazí pruh, že se dívá na poslední staženou podobu.
// Bez toho by tiše ukazovala včerejšek jako dnešek, což je přesně ta věc,
// kterou KAM jinde vytýká ostatním.

const VERZE = "kam-v3";
const SKORAPKA = `${VERZE}-skorapka`;
const SOUBORY = `${VERZE}-soubory`;
const DATA = `${VERZE}-data`;
const NASE = [SKORAPKA, SOUBORY, DATA];

// Bez čeho se aplikace neotevře vůbec. Zbytek doteče za běhu.
const ZAKLAD = ["/", "/manifest.webmanifest", "/theme-init.js", "/favicon.svg", "/icon-192.png", "/icon-512.png"];
const SIT_STROP = 4000;

self.addEventListener("install", (e) => {
  // `addAll` selže celé, když jeden soubor chybí; proto každý zvlášť.
  e.waitUntil(caches.open(SKORAPKA).then((c) => Promise.all(ZAKLAD.map((u) => c.add(u).catch(() => null)))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!NASE.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Stránka si řekne o převzetí, až uživatel odsouhlasí obnovení.
self.addEventListener("message", (e) => { if (e.data === "prevzit") self.skipWaiting(); });

/** Síť s časovým stropem. Mobilní připojení, které přijímá spojení a pak mlčí,
 *  je horší než žádné — bez stropu by se aplikace nenačetla vůbec. */
function sitSeStropem(request, ms) {
  return new Promise((splnit, odmitnout) => {
    const cas = setTimeout(() => odmitnout(new Error("timeout")), ms);
    fetch(request).then((r) => { clearTimeout(cas); splnit(r); }, (err) => { clearTimeout(cas); odmitnout(err); });
  });
}

/** Skořápka z mezipaměti — poslední záchrana, když síť nedá nic. */
async function skorapka() {
  try {
    return (await caches.match("/", { ignoreSearch: true })) ?? Response.error();
  } catch {
    return Response.error();
  }
}

async function navigace(request) {
  let ze_site = null;
  try {
    ze_site = await sitSeStropem(request, SIT_STROP);
  } catch {
    ze_site = null;
  }
  if (ze_site && ze_site.ok) {
    // Uložení je vedlejší efekt, ne součást odpovědi: selhání zápisu nesmí
    // shodit stránku, která už ze sítě dorazila.
    caches.open(SKORAPKA).then((c) => c.put("/", ze_site.clone())).catch(() => null);
    return ze_site;
  }
  // Odpověď, která není v pořádku (500, 502), je pořád lepší poslat dál než
  // předstírat, že je vše v pořádku — jen skořápka nahradí úplné ticho.
  return ze_site ?? skorapka();
}

async function zMezipameti(request, jmeno) {
  try {
    const cache = await caches.open(jmeno);
    const ulozene = await cache.match(request);
    if (ulozene) return ulozene;
    const r = await fetch(request);
    if (r && r.ok && r.type === "basic") cache.put(request, r.clone());
    return r;
  } catch {
    // Mezipaměť umí selhat celá — plná kvóta, soukromé okno, prohlížeč
    // s vypnutým úložištěm. Kdyby se to propsalo do odpovědi, nenačte se
    // skript aplikace a zůstane bílá stránka. Sítí to projde i tak.
    return fetch(request);
  }
}

async function obnovitNaPozadi(request, jmeno) {
  try {
    const cache = await caches.open(jmeno);
    const ulozene = await cache.match(request);
    const sit = fetch(request).then((r) => { if (r && r.ok && r.type === "basic") cache.put(request, r.clone()); return r; }).catch(() => null);
    return ulozene ?? (await sit) ?? Response.error();
  } catch {
    return fetch(request);
  }
}

/** Řekne otevřeným oknům, jestli data tečou, nebo se berou z mezipaměti.
 *  `navigator.onLine` na to nestačí: když je mobil na síti, ale server je
 *  nedostupný, prohlížeč se pořád tváří jako online — a aplikace by tiše
 *  ukazovala včerejšek jako dnešek. */
function ohlas(stav) {
  self.clients.matchAll({ type: "window" }).then((okna) => okna.forEach((o) => o.postMessage({ kam: stav })));
}

async function api(request) {
  let cache = null;
  try {
    cache = await caches.open(DATA);
  } catch {
    // Bez mezipaměti se dá pořád chodit na síť; jen offline režim odpadne.
    return fetch(request);
  }
  try {
    // Bez časového stropu. Strop tu byl (4 s) a každá pomalá, ale fungující
    // odpověď — studený start na Cloud Run, výpočet rizik, simulace — se
    // počítala jako výpadek: podstrčila se kopie z mezipaměti a všem svítilo
    // „Bez spojení“, přestože spojení bylo. Na pomalou odpověď si počká
    // aplikace sama (`lib/api.ts` má vlastní časovač).
    const r = await fetch(request);
    if (r && r.ok) { cache.put(request, r.clone()); ohlas("online"); }
    return r;
  } catch (chyba) {
    // Dotaz, který stránka zrušila sama (odchod na jinou stránku, vlastní
    // časovač), není výpadek spojení a nesmí ho ohlásit.
    if (request.signal && request.signal.aborted) throw chyba;
    const ulozene = await cache.match(request);
    ohlas("offline");
    if (!ulozene) throw new Error("offline a bez uložené odpovědi");
    // Hlavička říká aplikaci, že se dívá na poslední staženou podobu.
    const h = new Headers(ulozene.headers);
    h.set("X-KAM-Offline", "1");
    return new Response(await ulozene.blob(), { status: ulozene.status, statusText: ulozene.statusText, headers: h });
  }
}

self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Proud událostí asistenta se nesmí ukládat ani obalovat — odpověď chodí po
  // kouscích a `clone()` by ji zadržel do konce.
  if ((request.headers.get("accept") || "").includes("text/event-stream")) return;

  // POZOR, kdyby se aplikace někdy vrátila za heslo: tahle větev se musí
  // zrušit. Přihlašovací okno umí vyvolat jedině prohlížeč sám při skutečné
  // navigaci; odpověď, která projde přes `respondWith`, ho nespustí a místo
  // něj se vykreslí holé „401 Unauthorized". Jednou už to celý web zamklo.
  // Dokud je aplikace veřejná, je nejdřív síť a skořápka jako záloha správně.
  if (request.mode === "navigate") { e.respondWith(navigace(request)); return; }
  // Znaky obcí se nemění (a když ano, přegeneruje je `scripts/erby.py`
  // spolu s novou verzí aplikace), takže z mezipaměti jako hashované soubory.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/erby/")) { e.respondWith(zMezipameti(request, SOUBORY)); return; }
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/health") return;
    e.respondWith(api(request));
    return;
  }
  e.respondWith(obnovitNaPozadi(request, SKORAPKA));
});
