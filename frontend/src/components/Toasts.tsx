import { dismiss, useToasts } from "../lib/toast";
import { Icon } from "./Icon";

const ICON = { ok: "check", info: "info", warn: "alert", error: "alert" } as const;

export function Toasts() {
  const items = useToasts();
  return (
    <>
      <div id="live-region" className="visually-hidden" role="status" aria-live="polite" />
      <div id="alert-region" className="visually-hidden" role="alert" aria-live="assertive" />
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast glass toast-${t.kind}`}>
            <Icon name={ICON[t.kind]} size={18} />
            <span>{t.text}</span>
            {t.action && <button className="btn btn-quiet btn-sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Zavřít hlášení"><Icon name="close" size={15} /></button>
          </div>
        ))}
      </div>
    </>
  );
}
