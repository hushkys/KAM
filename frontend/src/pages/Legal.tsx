import { Card, PageHeader } from "../components/ui";
import { Link } from "../lib/router";

const SECTIONS = [
  { id: "provozovatel", title: "Provozovatel a účel" },
  { id: "ai", title: "Umělá inteligence" },
  { id: "modely", title: "Výhledy a scénáře" },
  { id: "data", title: "Zdroje dat a licence" },
  { id: "osobni-udaje", title: "Ochrana osobních údajů" },
  { id: "pristupnost", title: "Přístupnost" },
  { id: "bezpecnost", title: "Bezpečnost" },
  { id: "licence", title: "Licence zdrojového kódu" },
  { id: "odpovednost", title: "Omezení odpovědnosti" },
];

export function Legal() {
  return (
    <>
      <PageHeader eyebrow="Právní informace" title="Podmínky, soukromí a AI" lead="Stručně a srozumitelně: co aplikace dělá s daty, co umí umělá inteligence a kde má KAM své hranice." />
      <div className="grid">
        <div className="span-3 hide-sm"><nav className="toc" aria-label="Obsah">{SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}</nav></div>
        <Card span={9} i={1}>
          <div className="prose">
            <h2 id="provozovatel">Provozovatel a účel</h2>
            <p>KAM — Krajský analytický model je prototyp vytvořený týmem Popojedem. pro Hackathon Královéhradeckého kraje. Slouží k analýze otevřených dat, orientačním výhledům a simulaci dopadů veřejných rozhodnutí. Není informačním systémem veřejné správy ani oficiálním výstupem Královéhradeckého kraje.</p>

            <h2 id="ai">Umělá inteligence</h2>
            <p>Asistent v aplikaci je systém umělé inteligence. V souladu s požadavky na transparentnost (nařízení EU o umělé inteligenci, čl. 50) je každá jeho odpověď označena a doplněna upozorněním, že <strong>odpovědi generuje AI a mohou být chybné</strong>.</p>
            <ul>
              <li>Čísla nepočítá jazykový model, ale analytické moduly KAM; model je pouze vysvětluje a cituje zdroje.</li>
              <li>Odpovědi nejsou právní, finanční, zdravotní ani jinou odbornou radou.</li>
              <li>Asistent je chráněn proti manipulaci (jailbreak, prompt injection) a odpovídá jen k tématům aplikace.</li>
              <li>Ve výchozím nastavení běží dotazy na lokálním modelu. Předávání cloudovému modelu určuje uživatel v <Link to="/nastaveni/soukromi">Nastavení → Data a soukromí</Link>.</li>
            </ul>

            <h2 id="modely">Výhledy a scénáře</h2>
            <p>Výhledy 2026–2040 a simulace zásahů jsou modelové odhady za výslovně uvedených předpokladů, ne předpovědi. Aplikace rozlišuje fakta (měřená data), trendy, modelové výstupy, scénáře a AI interpretaci. Souvislost v datech neznamená příčinu.</p>

            <h2 id="data">Zdroje dat a licence</h2>
            <p>Aplikace využívá otevřená data z Národního katalogu otevřených dat, portálu Data KHK, Českého statistického úřadu (Městská a obecní statistika), Českého úřadu zeměměřického a katastrálního (RÚIAN), Ministerstva financí, Digitální a informační agentury, MPSV a AOPK ČR. Data jsou užita podle podmínek jednotlivých datových sad, zpravidla licence CC BY 4.0. U každé sady je v sekci <Link to="/data">Data</Link> odkaz na její záznam v katalogu. Hranice území: © ČÚZK.</p>
            <p>Znaky obcí a kraje pocházejí z Wikimedia Commons, spárované s obcemi přes Wikidata podle kódu obce z RÚIAN. Jde o úřední symboly územních samosprávných celků; v aplikaci slouží jen k rozlišení území. Původní soubor ke každému znaku je v <a href="/erby/zdroje.json" target="_blank" rel="noopener noreferrer">seznamu zdrojů</a>. Obec, jejíž znak se nepodařilo dohledat, má místo něj neutrální štít s počátečním písmenem.</p>

            <h2 id="osobni-udaje">Ochrana osobních údajů</h2>
            <ul>
              <li>Aplikace nevyžaduje registraci a nepoužívá sledovací ani reklamní cookies. Preference vzhledu se ukládají jen ve vašem prohlížeči (technicky nezbytné úložiště).</li>
              <li>Podněty jsou anonymní. E-maily, telefonní čísla a rodná čísla se v textu automaticky skryjí ještě před uložením.</li>
              <li>Historii konverzací s asistentem lze vypnout; ukládá se s maskováním osobních údajů a maže se po nastavené době (výchozí 30 dní).</li>
              <li>Kam se data odesílají (lokální model, cloudový model, webhook, e-mail), nastavuje provozovatel instance v Nastavení.</li>
              <li>Zpracování se řídí nařízením GDPR a zákonem č. 110/2019 Sb. Nezadávejte do podnětů ani dotazů údaje o jiných osobách.</li>
            </ul>

            <h2 id="pristupnost">Přístupnost</h2>
            <p>Cílem je soulad s WCAG 2.1 na úrovni AA (zákon č. 99/2019 Sb.): ovládání klávesnicí, čtečky obrazovky (popisky, živé oblasti), vysoký kontrast, nastavitelná velikost písma a omezení animací.</p>

            <h2 id="bezpecnost">Bezpečnost</h2>
            <p>Přísná Content Security Policy, omezení počtu požadavků, šifrované ukládání API klíčů, ochrana webhooků proti přesměrování do vnitřní sítě, validace všech vstupů a oddělení instrukcí asistenta od vyhledaných dat.</p>

            <h2 id="licence">Licence zdrojového kódu</h2>
            <p>Zdrojový kód je uvolněn pod licencí MIT. Podle pravidel hackathonu jej lze zveřejnit a volně užít, včetně zveřejnění na GitHubu Královéhradeckého kraje.</p>

            <h2 id="odpovednost">Omezení odpovědnosti</h2>
            <p>Aplikace je poskytována tak, jak je. Otevřená data mohou obsahovat chyby nebo zpoždění. Rozhodnutí veřejné správy musí vycházet z ověřených podkladů; KAM je nástroj pro orientaci a diskusi, nikoli jejich náhrada.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
