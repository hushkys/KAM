// Tým po oblastech: každý sloupec je jedna oblast, nahoře její vedoucí,
// pod ním lidé, kteří v ní pracují. Sloupec je jedna oblast, ne jedna osoba —
// proto se na úzké obrazovce celý přesune pod druhý a nerozpadne se.

import type { CSSProperties } from "react";
import { Avatar, Chranice, OBLASTI, type Clovek } from "./Avatars";

function Osoba({ p, i }: { p: Clovek; i: number }) {
  return (
    <article className="person reveal" style={{ "--i": i } as CSSProperties}>
      {p.chranice && <span className="person-odznak" title="Chrániče na kolena — týmový vtip"><Chranice /></span>}
      <Avatar who={p.who} title={p.name} />
      <strong>{p.name}</strong>
      <span className="role">{p.role}</span>
      <span className="school">{p.school}</span>
    </article>
  );
}

export function Team() {
  return (
    <div className="team">
      {OBLASTI.map((o, oi) => (
        <section className="team-oblast" key={o.key}>
          <header className="oblast-head">
            <span className="oblast-eyebrow">Vedení oblasti</span>
            <h3>{o.name}</h3>
          </header>
          <article className="lead-card reveal" style={{ "--i": oi } as CSSProperties}>
            <Avatar who={o.lead.who} title={o.lead.name} size={112} />
            <div className="lead-text">
              <span className="lead-badge">Vedoucí · {o.name}</span>
              <strong>{o.lead.name}</strong>
              <span className="role">{o.lead.role}</span>
              <span className="school">{o.lead.school}</span>
            </div>
          </article>
          {o.lide.map((p, i) => <Osoba key={p.name} p={p} i={oi + i + 2} />)}
        </section>
      ))}
    </div>
  );
}
