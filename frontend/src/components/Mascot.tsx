// Maskot KAM. — ta tečka z loga, která ožila.
//
// Značka je „KAM." a jediné místo, kde je limetka v plné síle, je ta tečka za
// M. Maskot proto není nová postava přilepená vedle loga: je to ta tečka.
// Díky tomu je značkově vlastní (nedá se odlepit a použít jinde), na tričko se
// vytiskne ve dvou barvách bez přechodů a rastrů, a animace příchodu dává
// smysl sama od sebe — přikutálí se a sedne si na své místo ve slově.
//
// Kreslí se do čtverce 100×100 s tělem o poloměru 46, takže se dá zvětšit na
// plakát i zmenšit na favicon. Žádné stíny ani přechody: sítotisk je plocha.

import { useEffect, useState } from "react";

export type MascotLook = "vpred" | "vzhuru" | "vpravo";
export type MascotMood = "klid" | "radost" | "uzas";

/** Samotná postava. `look` natáčí zorničky, `mood` mění ústa.
 *  Bez animací — ty patří k místu, kde maskot vystupuje, ne k němu. */
export function Mascot({ size = 96, look = "vpred", mood = "radost", title, ...rest }: {
  size?: number; look?: MascotLook; mood?: MascotMood; title?: string;
} & React.SVGProps<SVGSVGElement>) {
  // Zornička se posouvá uvnitř oka, ne oko uvnitř hlavy — pohled se tím čte
  // jako pozornost, ne jako šilhání.
  const pupil = { vpred: [0, 0], vzhuru: [0, -2.4], vpravo: [2.6, -0.6] }[look];
  const mouth = {
    klid: "M40 64h20",
    radost: "M38.5 61c3.4 6.4 19.6 6.4 23 0",
    uzas: "M50 63.5m-6 0a6 5.4 0 1 0 12 0a6 5.4 0 1 0 -12 0",
  }[mood];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role={title ? "img" : "presentation"}
      aria-label={title} aria-hidden={title ? undefined : true} className="mascot" {...rest}>
      <circle cx="50" cy="50" r="46" className="ms-body" />
      <g className="ms-face">
        <ellipse cx="34" cy="43" rx="7.5" ry="9" className="ms-eye" />
        <ellipse cx="66" cy="43" rx="7.5" ry="9" className="ms-eye" />
        <circle cx={34 + pupil[0]} cy={43 + pupil[1]} r="3.1" className="ms-pupil" />
        <circle cx={66 + pupil[0]} cy={43 + pupil[1]} r="3.1" className="ms-pupil" />
        <path d={mouth} className={`ms-mouth${mood === "uzas" ? " is-open" : ""}`} />
      </g>
    </svg>
  );
}

/** Příchod maskota na úvodní obrazovku.
 *
 *  Přikutálí se zleva (otáčení je vázané na posun, takže se nesmýká), zastaví
 *  se, vyhrkne slogan do bubliny a zůstane stát u výzvy k akci. Není to
 *  překryv: nic neblokuje, dá se to přeskočit kliknutím a po prvním zhlédnutí
 *  se to v téhle relaci už nepřehraje — reklama, kterou musíte odklikat při
 *  každém načtení, je horší než žádná.
 *
 *  Při „omezit pohyb" se neanimuje nic: maskot rovnou stojí na místě a bublina
 *  je vidět. Obsah se tím neztrácí, jen se nehýbe.
 */
export function MascotIntro({ slogan = "Vidět, kam to směřuje." }: { slogan?: string }) {
  const KEY = "kam.maskot.videno";
  const [stav, setStav] = useState<"ceka" | "jede" | "mluvi" | "stoji">("ceka");

  useEffect(() => {
    let videno = false;
    try { videno = sessionStorage.getItem(KEY) === "1"; } catch { /* privátní režim */ }
    const tichy = document.documentElement.dataset.motion === "reduce"
      || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (videno || tichy) { setStav("stoji"); return; }
    try { sessionStorage.setItem(KEY, "1"); } catch { /* privátní režim */ }
    const t1 = setTimeout(() => setStav("jede"), 420);
    const t2 = setTimeout(() => setStav("mluvi"), 1750);
    const t3 = setTimeout(() => setStav("stoji"), 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div className="ms-intro" data-stav={stav} onClick={() => setStav("stoji")}>
      <div className="ms-runner">
        <Mascot size={72} look={stav === "mluvi" ? "vzhuru" : "vpravo"} mood={stav === "mluvi" ? "uzas" : "radost"}
          title="Maskot KAM." />
      </div>
      <p className="ms-bubble" aria-live="polite">{slogan}</p>
    </div>
  );
}
