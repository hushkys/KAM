// Tým jako jeden seznam, ne čtyři krabice.
//
// Čtyři karty vedle sebe vypadaly jako ceník: každý ve svém rámečku, všichni
// stejně daleko od sebe, žádné pořadí. Tým ale pořadí má — dvě oblasti a
// v každé někdo, kdo ji vede — a to se v mřížce ztratí. Řádek pod řádkem to
// řekne samo: portrét, jméno, čím se zabývá, a vpravo oblast.
//
// Řádky nesou `data-p`, takže se na úvodní stránce vezou s paralaxou (styl
// v `hook.css`); jinde je to obyčejný seznam.
//
// Poslední řádek je odkaz na vlastní web týmu. Je schválně součástí seznamu,
// ne tlačítko někde bokem: komponenta se vykresluje na úvodní stránce i na
// stránce O nás, takže odkaz stojí na obou místech, kde se o týmu mluví, a
// nemůže se stát, že se přidá jen na jedno.

import type { CSSProperties } from "react";
import { Avatar, Chranice, TEAM } from "./Avatars";
import { Icon } from "./Icon";

export const WEB_TYMU = "https://popojedem-web.web.app/#top";

export function Team() {
  return (
    <div className="tym">
      {TEAM.map((p, i) => (
        <article className="tym-radek" key={p.name} data-p style={{ "--i": i } as CSSProperties}>
          <span className="tym-portret">
            <Avatar who={p.who} size={104} title={p.name} />
            {p.chranice && <span className="tym-odznak" title="Chrániče na kolena — týmový vtip"><Chranice size={22} /></span>}
          </span>
          <div className="tym-text">
            <strong className="tym-jmeno">{p.name}</strong>
            <span className="tym-role">{p.role}</span>
            <span className="tym-skola">{p.school}</span>
          </div>
          <span className="tym-oblast">
            {p.vede && <i>vede</i>}
            {p.oblast}
          </span>
        </article>
      ))}
      <a className="tym-radek tym-web" href={WEB_TYMU} target="_blank" rel="noopener noreferrer"
        data-p style={{ "--i": TEAM.length } as CSSProperties}>
        <span className="tym-portret tym-znak" aria-hidden="true">
          <span className="tym-znak-tecka" />
        </span>
        <div className="tym-text">
          <strong className="tym-jmeno">Popojedem.</strong>
          <span className="tym-role">Web týmu</span>
          <span className="tym-skola">popojedem-web.web.app</span>
        </div>
        <span className="tym-oblast tym-oblast-web">
          Otevřít <Icon name="arrow-up-right" size={15} />
        </span>
      </a>
    </div>
  );
}
