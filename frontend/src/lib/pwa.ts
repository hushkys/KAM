// Instalace aplikace na plochu a hlídání nové verze.
//
// Tři věci, které se liší podle prohlížeče a nedají se sloučit:
//   – Chrome a spol. pošlou `beforeinstallprompt`, který se dá schovat
//     a vyvolat později vlastním tlačítkem;
//   – Safari na iOS žádnou takovou událost nemá a instaluje se ručně přes
//     Sdílet → Přidat na plochu, takže tam zbývá napsat návod;
//   – v už nainstalované aplikaci se nesmí nabízet ani jedno.
//
// Aktualizace: nová verze se nikdy nenasadí pod rukama. Service worker počká
// jako `waiting`, aplikace nabídne obnovení a teprve po odsouhlasení převezme
// řízení. Výměna uprostřed rozepsaného scénáře by byla horší než stará verze.

import { toast } from "./toast";

let vyzva: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const posluchaci = new Set<() => void>();
const zmena = () => posluchaci.forEach((p) => p());

/** Běží aplikace jako nainstalovaná (z plochy), nebo v prohlížeči? */
export function jeNainstalovana(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: minimal-ui)").matches
    // iOS Safari nezná `display-mode`, ale nastaví tohle.
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Zbývá na iOS jen ruční návod? Čistá funkce kvůli testu — `iPadOS` se od
 *  verze 13 hlásí jako Mac, pozná se tedy až podle dotykových bodů. */
export function potrebaIosNavod(ua: string, dotyky: number, nainstalovana: boolean): boolean {
  if (nainstalovana) return false;
  const iPhone = /iPad|iPhone|iPod/.test(ua);
  const iPad = /Macintosh/.test(ua) && dotyky > 1;
  if (!iPhone && !iPad) return false;
  // Na iOS je pod kapotou vždy WebKit, ale „Přidat na plochu" umí jen Safari.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function lzeVyzvat(): boolean {
  return vyzva !== null;
}

export function sledujInstalaci(p: () => void): () => void {
  posluchaci.add(p);
  return () => { posluchaci.delete(p); };
}

/** Vyvolá systémové okno. Vrací, jestli uživatel instalaci potvrdil. */
export async function nabidniInstalaci(): Promise<boolean> {
  if (!vyzva) return false;
  const v = vyzva;
  vyzva = null;
  zmena();
  await v.prompt();
  const { outcome } = await v.userChoice;
  return outcome === "accepted";
}

export function initPwa(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Bez `preventDefault` si prohlížeč zobrazí vlastní pruh a vlastní
    // tlačítko v nastavení by pak bylo druhé v pořadí a matoucí.
    e.preventDefault();
    vyzva = e as typeof vyzva;
    zmena();
  });
  window.addEventListener("appinstalled", () => { vyzva = null; zmena(); });

  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  // Až po `load`: registrace jinak soupeří o pásmo s prvním vykreslením.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      let obnovuji = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (obnovuji) return;
        obnovuji = true;
        window.location.reload();
      });
      const hlidej = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener("statechange", () => {
          // `controller` existuje jen tehdy, když už nějaká verze běžela —
          // při úplně první instalaci se nic nabízet nemá.
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            toast("info", "Je k dispozici nová verze aplikace.", { label: "Obnovit", run: () => w.postMessage("prevzit") }, 12000);
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        toast("info", "Je k dispozici nová verze aplikace.", { label: "Obnovit", run: () => reg.waiting?.postMessage("prevzit") }, 12000);
      }
      reg.addEventListener("updatefound", () => hlidej(reg.installing));
    }).catch(() => {
      // Bez service workeru aplikace funguje dál, jen nefunguje offline.
    });
  });
}
