import { Icon } from "../components/Icon";
import { Empty } from "../components/ui";
import { Link } from "../lib/router";

export function NotFound() {
  return (
    <Empty icon="compass" title="Tahle stránka neexistuje" action={<Link className="btn btn-primary" to="/prehled"><Icon name="arrow-left" size={16} /> Otevřít přehled kraje</Link>}>
      Odkaz je nejspíš zastaralý. Hledanou obec nebo stránku najdete přes hledání (Ctrl+K).
    </Empty>
  );
}
