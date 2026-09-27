// Odstín hlavičky podle modulu, do kterého stránka patří.
//
// Barvy si nepíšou samy — berou se ze `ModuleIcon`, aby hlavička měla
// přesně ten odstín, který má ikona modulu v navigaci, a aby se to při změně
// palety nerozešlo. Posílají se tři surové odstíny (`--hs` světlejší, `--ht`
// sytější, `--hp` bledý) a který z nich nese čáru grafu, rozhoduje styl podle
// motivu: na světlém podkladu sytý, na tmavém světlý.

import type { CSSProperties } from "react";
import { modulBarvy } from "./ModuleIcon";

export function hookTema(modul: string): CSSProperties {
  const b = modulBarvy(modul);
  return { ["--hs" as string]: b.a, ["--ht" as string]: b.b, ["--hp" as string]: b.c } as CSSProperties;
}

/** Barva i označení modulu jedním rozbalením. `data-vstup` nese jméno
 *  modulu pro styl, kdyby některá hlavička potřebovala vlastní úpravu. */
export function hookVstup(modul: string): { style: CSSProperties; "data-vstup": string } {
  return { style: hookTema(modul), "data-vstup": modul };
}
