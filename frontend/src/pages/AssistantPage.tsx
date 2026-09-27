// Asistent: conversations on the left, the chat filling the rest of the
// screen. The page never scrolls; only the conversation does, and the empty
// state is sized to fit without scrolling. On a phone the history moves into
// a sheet behind the "Historie" button.

import { useEffect, useState } from "react";
import { Chat, useChat } from "../components/Assistant";
import { useAssistantState } from "../components/assistantBus";
import { Icon } from "../components/Icon";
import { Modal } from "../components/ui";
import { api, useApi } from "../lib/api";
import { ago, num, plural } from "../lib/format";

interface Status { providers: { name: string; tier: string; model: string; ok: boolean | null; error: string | null }[]; policy: string; rag: { docs: number; vector_coverage: number } }
interface Session { id: string; title: string; updated_at: string }

function Sessions({ rows, active, onPick, onDelete }: { rows: Session[]; active: string; onPick: (id: string) => void; onDelete: (id: string) => void }) {
  if (!rows.length) return <p className="small mute ai-empty-hist">Zatím žádné konverzace.</p>;
  return (
    <div className="ai-sessions">
      {rows.map((r) => (
        <div key={r.id} className={`ai-session ${r.id === active ? "is-on" : ""}`}>
          <button className="ai-session-main" onClick={() => onPick(r.id)}>
            <span className="ai-session-title">{r.title}</span>
            <span className="ai-session-date">{ago(r.updated_at)}</span>
          </button>
          <button className="icon-btn sm" aria-label={`Smazat konverzaci ${r.title}`} onClick={() => onDelete(r.id)}><Icon name="trash" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function AssistantPage() {
  const st = useAssistantState();
  const chat = useChat(st.territory);
  const { data } = useApi<Status>("/ai/status");
  const [rows, setRows] = useState<Session[]>([]);
  const [sheet, setSheet] = useState(false);
  const reload = () => api<Session[]>("/chat/sessions").then(setRows).catch(() => {});
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (!chat.busy) reload(); }, [chat.busy]);
  const pick = (id: string) => { chat.load(id); setSheet(false); };
  const del = async (id: string) => { await api(`/chat/sessions/${id}`, { method: "DELETE" }); if (id === chat.sid) chat.reset(); reload(); };

  const status = (
    <div className="ai-status">
      {data?.providers.map((p) => (
        <span key={p.name} className="ai-status-row" title={p.error ?? ""}>
          <span className="status-dot" style={{ background: p.ok ? "var(--ok)" : "var(--bad)" }} />
          <span className="ellipsis">{p.name}</span>
          <span className="mute xsmall">{p.tier === "cloud" ? "v cloudu" : "na serveru"}</span>
        </span>
      ))}
      {data && <span className="ai-status-row"><Icon name="database" size={13} /><span className="ellipsis">Podklady: {num(data.rag.docs)} {plural(data.rag.docs, "dokument", "dokumenty", "dokumentů")}</span></span>}
    </div>
  );

  return (
    <div className="ai-page">
      <aside className="ai-side" aria-label="Konverzace">
        <button className="btn btn-primary btn-block" onClick={chat.reset}><Icon name="plus" size={16} /> Nová konverzace</button>
        <div className="ai-side-label">Historie</div>
        <Sessions rows={rows} active={chat.sid} onPick={pick} onDelete={del} />
        <div className="ai-side-foot">{status}<p className="xsmall mute">Ctrl+J otevře asistenta na kterékoli stránce.</p></div>
      </aside>
      <section className="ai-main">
        <Chat territory={st.territory} chat={chat} header={
          <button className="btn btn-sm btn-quiet ai-hist-btn" onClick={() => setSheet(true)} aria-label="Historie konverzací"><Icon name="history" size={16} /> Historie</button>
        } />
      </section>
      <Modal open={sheet} onClose={() => setSheet(false)} title="Historie konverzací">
        <button className="btn btn-primary btn-block" onClick={() => { chat.reset(); setSheet(false); }}><Icon name="plus" size={16} /> Nová konverzace</button>
        <div className="section-gap" />
        <Sessions rows={rows} active={chat.sid} onPick={pick} onDelete={del} />
        <div className="section-gap" />
        {status}
      </Modal>
    </div>
  );
}
