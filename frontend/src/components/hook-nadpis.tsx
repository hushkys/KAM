// Nadpis hooku: rozpadne se na slova, aby mohl nabíhat po částech.
//
// Kdyby se animoval celý odstavec najednou, je to jen fade — pohyb po slovech
// dá větě rytmus a oko jde zleva doprava tak, jak se čte. Každé slovo má svůj
// index v `--w`, prodleva se počítá z něj v CSS; tady se nic nečasuje.
//
// Maska je dost velká na diakritiku. Čeština má háčky nad velkými písmeny
// (Ř, Ú) i dolní dotahy (y, j) a těsný rámeček by je uřízl — proto `padding`
// a záporný `margin`, který ho zase vyruší, aby se nerozhodila sazba.
//
// Rozdělují se jen textové uzly. `<br />` a vnořené prvky (čísla z dat, `<i>`)
// projdou beze změny; nadpis se skládá z hodnot, které přišly z modelu, a ty
// se nesmí přepsat na řetězec.

import { Children, isValidElement, type ReactNode } from "react";

interface Stav { n: number }

function projdi(uzel: ReactNode, stav: Stav): ReactNode {
  if (typeof uzel === "string" || typeof uzel === "number") {
    const text = String(uzel);
    // `split` s mezerou v regulárním výrazu si mezery ponechá jako položky,
    // takže se nikde neslepí dvě slova dohromady.
    return text.split(/(\s+)/).map((kus, i) => {
      if (!kus) return null;
      if (/^\s+$/.test(kus)) return kus;
      return (
        <span className="hn-slovo" key={`${stav.n}-${i}`} style={{ ["--w" as string]: stav.n++ }}>
          <span>{kus}</span>
        </span>
      );
    });
  }
  if (Array.isArray(uzel)) return Children.map(uzel, (d) => projdi(d, stav));
  if (isValidElement(uzel)) {
    const props = uzel.props as { children?: ReactNode };
    if (props?.children === undefined) return uzel;         // <br />, ikony
    return { ...uzel, props: { ...props, children: projdi(props.children, stav) } };
  }
  return uzel;
}

export function NadpisHooku({ id, children }: { id?: string; children: ReactNode }) {
  return <h1 id={id} className="hook-nadpis">{projdi(children, { n: 0 })}</h1>;
}
