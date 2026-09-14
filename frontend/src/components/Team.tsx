// Team layout: the two leads, one under the other, then the rest of the team.

import type { CSSProperties } from "react";
import { Avatar, TEAM } from "./Avatars";

export function Team() {
  const leads = TEAM.filter((p) => p.lead);
  const rest = TEAM.filter((p) => !p.lead);
  return (
    <div className="team">
      <div className="team-leads">
        {leads.map((p, i) => (
          <article className="lead-card reveal" key={p.name} style={{ "--i": i } as CSSProperties}>
            <Avatar who={p.who} title={p.name} size={112} />
            <div className="lead-text">
              <span className="lead-badge">Vedoucí týmu · hlavní vývojář</span>
              <strong>{p.name}</strong>
              <span className="role">{p.role}</span>
              <span className="school">{p.school}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="team-grid">
        {rest.map((p, i) => (
          <article className="person reveal" key={p.name} style={{ "--i": i + 2 } as CSSProperties}>
            <Avatar who={p.who} title={p.name} />
            <strong>{p.name}</strong>
            <span className="role">{p.role}</span>
            <span className="school">{p.school}</span>
          </article>
        ))}
      </div>
    </div>
  );
}
