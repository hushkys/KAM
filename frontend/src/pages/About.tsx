import { Card, PageHeader } from "../components/ui";
import { Team } from "../components/Team";

export function About() {
  return (
    <>
      <PageHeader eyebrow="Tým Popojedem." title="Kdo stojí za KAM" lead="Loni jsme postavili KompaZ — průvodce krizovými situacemi v kraji. Letos jsme popojeli dál: od toho, co dělat, když problém nastane, k tomu, jak ho vidět dřív." />
      <div className="stack-y">
        <Team />
        <div className="grid">
          <Card span={6} i={1} title="Co děláme" icon="users">
            <div className="prose">
              <p><strong>Ondřej Hušek</strong> a <strong>Josef Efler</strong> vedou tým a jsou hlavními vývojáři KAM. Ondřej navrhl architekturu a postavil aplikaci od sklizně dat přes analytické a simulační jádro po AI vrstvu; Josef vede produktový směr, brainstorming a příběh projektu.</p>
              <p><strong>Matěj Jirásek</strong> odpovídá za uživatelský zážitek a vizuální jazyk — aby byla složitá data srozumitelná na první pohled.</p>
              <p><strong>Damián Roháček</strong> se stará o backend, datové služby a jejich spolehlivost.</p>
            </div>
          </Card>
          <Card span={6} i={2} title="Odkud jsme" icon="school">
            <div className="prose">
              <p>Ondřej, Matěj a Damián studují bakalářský program <strong>Informační a síťová bezpečnost</strong> na Fakultě informatiky a managementu Univerzity Hradec Králové.</p>
              <p>Josef studuje na <strong>Univerzitě Tomáše Bati ve Zlíně</strong> se zaměřením na marketing.</p>
            </div>
          </Card>
          <Card span={12} i={3} title="Proč KAM" icon="target">
            <div className="prose" style={{ maxWidth: "none" }}>
              <p>Dat o krajích je hodně, ale leží v desítkách tisíc oddělených sad a popisují hlavně minulost. KAM je spojuje do jednoho modelu: ukazuje, co se děje, odkud to víme, kam to při současných trendech směřuje a co se změní, když zasáhneme. Čísla počítají transparentní metody nad otevřenými daty; umělá inteligence je jen vysvětluje a každé tvrzení odkazuje na zdroj.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
