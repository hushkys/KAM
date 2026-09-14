// Odstín hooku podle modulu, do kterého stránka patří.
//
// Hooky vypadaly všechny stejně zeleně, takže se od sebe nedaly poznat.
// Barvy si ale nepíšou samy — berou se ze `ModuleIcon`, aby stránka měla
// přesně ten odstín, který má její ikona v docku, a aby se to při změně
// palety nerozešlo.

import type { CSSProperties } from "react";
import { modulBarvy } from "./ModuleIcon";

export function hookTema(modul: string): CSSProperties {
  const b = modulBarvy(modul);
  return { ["--h1" as string]: b.a, ["--h2" as string]: b.b, ["--h3" as string]: b.c } as CSSProperties;
}
