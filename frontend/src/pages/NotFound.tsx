import { Icon } from "../components/Icon";
import { Empty } from "../components/ui";
import { Link } from "../lib/router";

export function NotFound() {
  return (
    <Empty icon="compass" title="Tato stránka neexistuje" action={<Link className="btn btn-primary" to="/prehled"><Icon name="arrow-left" size={16} /> Na přehled</Link>}>
      Odkaz je možná zastaralý. Zkuste hledání (Ctrl+K).
    </Empty>
  );
}
