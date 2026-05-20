# Scrum Flow Integratie & ART Dashboard

Dit project biedt een **Agile Release Train (ART) Dashboard** dat direct koppelt met je Jira-omgeving om PI-voortgang, team-afhankelijkheden en overkoepelende flow metrics te visualiseren. 

**Het belangrijkste kenmerk? Privacy by Design.**
In tegenstelling tot veel andere tools, exporteert dit dashboard **geen** gevoelige Jira-data (zoals story points, teamnamen of titels) naar externe servers. De gegenereerde integratie-code draait volledig client-side (bijvoorbeeld in een Confluence HTML-macro). De data wordt uitsluitend via de API in de browser van de ingelogde gebruiker opgehaald en verwerkt.

## Features

- **Live Jira Integratie:** Haalt data live op via de Jira REST API (JQL ondersteund).
- **Program Increment (PI) Tracking:** PI Burnup charts met ideale projectielijnen op basis van kalenderdagen.
- **Geavanceerde Flow Metrics:**
  - **Trein Overzicht (CFD):** Cumulatieve werkstroom om knelpunten te identificeren.
  - **Lead Time per Team:** Inclusief wiskundig betrouwbare P85 (85e percentiel) berekeningen.
  - **Flow Efficiency:** Inzicht in de actieve bewerkingstijd versus wachttijd (Cycle Time vs Lead Time).
  - **Throughput & Kwaliteit:** Week-tot-week afgeronde issues en 'Failure Demand' (Bugs vs Waarde).
  - **WIP Aging:** Identificeer direct de oudste vastgeroeste items ('In Progress' risico's).
- **Slimme Sprint Cadans Parser:** Herkent automatisch semantische sprintnamen (bijv. `2026 Q1 - Sprint 3` of `S3Q126`) om betrouwbare velocity over de hele trein te meten.
- **Ingebouwde Diagnostiek:** Een debug-modal om ontbrekende velden (zoals ontbrekende Dev Start data of niet-herkende sprintnamen) snel op te sporen voor Scrum Masters.

## Hoe het werkt (Installatie)

Dit project bestaat in de basis uit twee delen: de generator (`art-integratie.html`) en de reken/teken-engine (`analyse.js`).

1. **Genereer de snippet:**
   Open `art-integratie.html` in je browser. Vul de basis-URL in van jullie Jira-omgeving (bijv. `https://jira.jouwbedrijf.nl`) en klik op 'Genereer Code'.
2. **Implementeer in jullie omgeving:**
   Je krijgt nu een stuk HTML/JS code. Plak deze code in jullie eigen intranet of binnen een **HTML-macro op een Confluence-pagina**.
3. **Klaar voor gebruik:**
   Zodra een gebruiker de pagina bezoekt (en is ingelogd bij Jira), zal het script veilig de issues ophalen en `analyse.js` inladen om de interactieve HTML5 Canvas grafieken te tekenen.

## Technische Vereisten (Jira Custom Fields)

Om metrics zoals Lead Time en Cycle Time te kunnen berekenen, leunt `analyse.js` op een aantal standaard en custom velden in de Jira API payload. Als jullie Jira-omgeving andere ID's gebruikt, kun je deze aanpassen in het `JIRA` object in `analyse.js`:

| Veld | Interne ID in dit script | Doel |
| :--- | :--- | :--- |
| **Team** | `customfield_10012` | Bepalen welk Agile team het issue oppakt. |
| **Sprints** | `customfield_10004` / `10020` | Toewijzen van cadans en velocity. |
| **Story Points** | `customfield_10002` | Voor de PI Burnup en Velocity berekening. |
| **Dev Start** | `customfield_13300` | Start van de Cycle Time (Wanneer begon het werk echt?). |
| **Dev End** | `customfield_13302` / `13301` | Einde van de Cycle Time. |
| **Epic Link** | `customfield_10005` | Relatie tot bovenliggende features. |

*Let op: Als `Dev Start` en `Dev End` niet zijn ingericht in jullie Jira, zal de 'Flow Efficiency' grafiek geen data tonen. De diagnostiek-tool in het dashboard helpt je dit op te sporen.*

## Technologie Stack

- **Pure HTML, CSS, JavaScript (ES6)**
- Geen zware frameworks (Geen React/Vue, geen Babel) voor maximale snelheid en compatibiliteit.
- Renders via native HTML5 `<canvas>` voor optimale prestaties bij honderden datapunten.
