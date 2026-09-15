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
//   /api/* GET → nejdřív síť, při výpadku poslední známá odpověď
//   ostatní    → z mezipaměti a na pozadí se obnoví
//
// Čísla z mezipaměti jsou pořád čísla z databáze, jen starší — proto aplikace
// v offline režimu zobrazí pruh, že se dívá na poslední staženou podobu.
// Bez toho by tiše ukazovala včerejšek jako dnešek, což je přesně ta věc,
// kterou KAM jinde vytýká ostatním.

const VERZE = "kam-v1";
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

async function navigace(request) {
  let ze_site = null;
  try {
    ze_site = await sitSeStropem(request, SIT_STROP);
  } catch {
    ze_site = null;
  }
  if (ze_site) {
    // Uložení skořápky je vedlejší efekt, ne součást odpovědi: kdyby selhalo
    // úložiště, nesmí to shodit navigaci, která ze sítě už dorazila.
    if (ze_site.ok) caches.open(SKORAPKA).then((c) => c.put("/", ze_site.clone())).catch(() => null);
    return ze_site;
  }
  try {
    return (await caches.match("/", { ignoreSearch: true })) ?? Response.error();
  } catch {
    return Response.error();
  }
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
    const r = await sitSeStropem(request, SIT_STROP);
    if (r && r.ok) { cache.put(request, r.clone()); ohlas("online"); }
    return r;
  } catch {
    const ulozene = await cache.match(request);
    if (!ulozene) { ohlas("offline"); throw new Error("offline a bez uložené odpovědi"); }
    ohlas("offline");
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

  if (request.mode === "navigate") { e.respondWith(navigace(request)); return; }
  if (url.pathname.startsWith("/assets/")) { e.respondWith(zMezipameti(request, SOUBORY)); return; }
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/health") return;
    e.respondWith(api(request));
    return;
  }
  e.respondWith(obnovitNaPozadi(request, SKORAPKA));
});
