/**
 * analyse.js - Agile Release Train (ART) Analysis Dashboard
 * Geoptimaliseerd voor prestaties, veiligheid, onderhoudbaarheid en dynamische UX.
 */

window.LUCAS_ANALYSE = {
    rawData: [],
    processedData: [],
    filteredData: [],
    piData: [],
    wipData: [], // FIX: Aparte dataset voor openstaand werk (voorkomt CFD/Burnup vervuiling)
    hierarchy: {}, 
    activeTeams: [],
    
    JIRA: {
        TEAM: 'customfield_10012',
        SPRINT_NEW: 'customfield_10004',
        SPRINT_OLD: 'customfield_10020',
        SPRINT_LEGACY: 'customfield_13303',
        STORY_PTS: 'customfield_10002',
        DEV_START: 'customfield_13300',
        DEV_END_1: 'customfield_13302',
        DEV_END_LAST: 'customfield_13301',
        EPIC_LINK: 'customfield_10005'
    },

    settings: {
        piName: "",
        piStart: "",
        piEnd: "",
        includedProjects: [],
        includedTeams: []
    },

    colors: { Bug:"#FF5630", Story:"#0052CC", Epic:"#6554C0", Task:"#36B37E", Other:"#97A0AF" },
    
    daysBetween: function(a, b) {
        if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return null;
        return parseFloat(((b - a) / 86400000).toFixed(2));
    },
    
    calculatePercentile: function(arr, p) { 
        if(!arr || !arr.length) return null; 
        const s = [...arr].filter(v => v !== null && !isNaN(v)).sort((x,y) => x - y);
        if(!s.length) return null;
        const i = (p/100) * (s.length - 1); 
        return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); 
    },

    escapeHtml: function(s) { 
        return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); 
    },

    parseCadence: function(name) {
        if (!name) return null;
        const n = name.toUpperCase();
        let y = null, q = null, s = null;

        const qMatch = n.match(/Q\s*([1-4])/);
        if (qMatch) q = "Q" + qMatch[1];

        const yMatch4 = n.match(/20(2[4-9])/);
        if (yMatch4) {
            y = "20" + yMatch4[1];
        } else if (q) {
            const m1 = n.match(/(?:^|[^0-9A-Z])([2][4-9])\s*Q[1-4]/);
            const m2 = n.match(/Q[1-4][\/\-\s]*([2][4-9])(?!\d)/);
            const m3 = n.match(/S[1-7]Q[1-4](?:20)?(2[4-9])(?!\d)/);
            if (m1) y = "20" + m1[1];
            else if (m2) y = "20" + m2[1];
            else if (m3) y = "20" + m3[1];
        }

        const s1 = n.match(/(?:^|[^A-Z])(?:SP|S)\s*([1-7])(?!\d)/);
        const s2 = n.match(/Q[1-4]\s*[\-\/]\s*([1-7])(?!\d)/);

        if (s1) {
            s = "Sprint " + s1[1];
        } else if (s2) {
            s = "Sprint " + s2[1];
        } else {
            const s3 = n.match(/SPRINT\s*(\d+)/);
            if (s3) {
                const num = parseInt(s3[1], 10);
                if (num >= 1 && num <= 7) s = "Sprint " + num;
                else return null;
            }
        }

        if (y && q && s) return `${y} ${q} - ${s}`;
        return null;
    },

    parseSortVal: function(str) {
        const m = str.match(/(\d{4}) Q([1-4]) \- Sprint ([1-7])/);
        if (!m) {
            console.warn("[ART] Onverwachte cadans-key bij sortering:", str);
            return 0;
        }
        return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) * 10 + parseInt(m[3], 10);
    },
    
    renderTooltip: function(text) {
        return `<span class="art-tooltip">(?)<span class="art-tooltip-text">${this.escapeHtml(text)}</span></span>`;
    },

    init: function(data) {
        this.rawData = data;
        this.runParserTests();
        this.processData(); 
        this.loadSettings();
        this.injectCSS();
        this.renderBaseHTML();
        this.applyFilters(); 
        
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        let resizeTimer;
        this._resizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if(this.piData.length > 0) this.drawCharts();
            }, 150);
        };
        window.addEventListener('resize', this._resizeHandler);
    },

    runParserTests: function() {
        const TESTS = [
            ["ART 2026 Q1 S3",         "2026 Q1 - Sprint 3"],
            ["S3Q126",                 "2026 Q1 - Sprint 3"],
            ["26Q1-3",                 "2026 Q1 - Sprint 3"],
            ["Sprint 42",              null],
            ["Q3-2026",                null],
            ["Team Alpha Sprint 5",    null],
            ["ART Q3-2 2026",          "2026 Q3 - Sprint 2"],
            ["ART Q3-2 PI5",           null],
            ["S4/Q1/26",               "2026 Q1 - Sprint 4"],
            ["(S6/Q1/26)",             "2026 Q1 - Sprint 6"],
            ["Sprint 53 (S1/Q2/26)",   "2026 Q2 - Sprint 1"],
            ["Sprint 9 (S2Q4)",        null]
        ];
        let failed = 0;
        TESTS.forEach(([input, expected]) => {
            const result = this.parseCadence(input);
            if (result !== expected) {
                console.error(`[ART Parser Test Gefaald] parseCadence("${input}"): verwacht "${expected}", kreeg "${result}"`);
                failed++;
            }
        });
        if (failed === 0) {
            console.log(`[ART] Alle ${TESTS.length} parser regressietests geslaagd.`);
        }
    },

    loadSettings: function() {
        try {
            const savedPi = localStorage.getItem('lucas_pi_settings');
            let fallbackPi = { name: "Huidige PI", start: "", end: "" };
            if (savedPi) fallbackPi = JSON.parse(savedPi);

            const savedArt = localStorage.getItem('lucas_art_settings');
            if (savedArt) {
                this.settings = { ...this.settings, ...JSON.parse(savedArt) };
                // FIX: Aggressieve loop verwijderd die uitgevinkte teams ongewenst opnieuw toevoegde.
                // We vertrouwen nu puur op de keuzes die de gebruiker in localStorage heeft opgeslagen.
            } else {
                this.settings.piName = fallbackPi.name;
                this.settings.piStart = fallbackPi.start;
                this.settings.piEnd = fallbackPi.end;
                
                this.settings.includedProjects = Object.keys(this.hierarchy);
                this.settings.includedTeams = [];
                Object.values(this.hierarchy).forEach(teams => {
                    this.settings.includedTeams.push(...Array.from(teams));
                });
            }
        } catch(e) { console.error('Fout bij inladen instellingen:', e); }
    },

    saveSettings: function() {
        try {
            localStorage.setItem('lucas_art_settings', JSON.stringify(this.settings));
        } catch(e) {
            console.warn('Instellingen konden niet worden opgeslagen:', e);
        }
    },

    injectCSS: function() {
        if(document.getElementById('lucas-art-css')) return;
        const style = document.createElement('style');
        style.id = 'lucas-art-css';
        style.textContent = `
            #art-dashboard { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #172B4D; width: 100%; font-size: 14px; }
            .art-topbar { display: flex; justify-content: space-between; align-items: center; background: #091E42; padding: 12px 20px; border-radius: 6px; color: white; margin-bottom: 20px; }
            .art-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: #fff; border-radius: 3px; padding: 6px 12px; font-size: 13px; cursor: pointer; font-weight: 600; transition: background 0.2s; }
            .art-btn:hover { background: rgba(255,255,255,0.2); }
            
            .art-card { background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(9,30,66,0.12); padding: 20px; border: 1px solid #DFE1E6; margin-bottom: 20px; display: flex; flex-direction: column; min-width: 0; }
            .art-card-title { font-size: 16px; font-weight: 600; color: #172B4D; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;}
            .art-card-sub { font-size: 12px; color: #6B778C; margin: 0 0 16px 0; border-bottom: 1px solid #DFE1E6; padding-bottom: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;}
            .art-cvs { width: 100%; height: 260px; display: block; }
            
            .art-badge { background: #EBECF0; color: #42526E; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }

            .art-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            
            .art-modal-bg { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(9,30,66,0.6); z-index: 9999; }
            .art-modal-box { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 6px; width: 800px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 8px 40px rgba(9,30,66,0.3); }
            .art-modal-header { padding: 20px; border-bottom: 1px solid #DFE1E6; display: flex; justify-content: space-between; align-items: center; background: #FAFBFC; border-radius: 6px 6px 0 0; }
            .art-modal-body { overflow-y: auto; padding: 20px; }
            .art-modal-close { background: none; border: none; font-size: 24px; color: #6B778C; cursor: pointer; }
            
            .art-lbl { display: block; font-size: 12px; font-weight: 700; color: #6B778C; text-transform: uppercase; margin-bottom: 6px; }
            .art-inp { width: 100%; padding: 8px 10px; border: 1px solid #DFE1E6; border-radius: 3px; font-size: 13px; box-sizing: border-box; }
            .art-chk-list { border: 1px solid #DFE1E6; border-radius: 3px; max-height: 350px; overflow-y: auto; padding: 10px; background: #FAFBFC; }
            .art-chk-item { margin-bottom: 6px; font-size: 13px; display: flex; align-items: center; color: #172B4D; }
            
            .art-proj-group { margin-bottom: 12px; border-bottom: 1px solid #EBECF0; padding-bottom: 8px; }
            .art-proj-lbl { font-weight: 600; color: #0052CC; margin-bottom: 4px; display: flex; align-items: center; cursor:pointer;}
            .art-team-container { padding-left: 24px; border-left: 2px solid #DFE1E6; margin-left: 6px; }

            .art-btn-primary { background: #0052CC; color: #fff; border: none; padding: 10px 16px; border-radius: 3px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 10px; }
            .art-btn-primary:hover { background: #0047B3; }

            .r-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; border-bottom: 1px dashed #f0f0f0; padding-bottom: 4px; }
            .r-val { color: #172B4D; font-family: monospace; font-weight: bold; }
            
            .wip-tbl { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
            .wip-tbl th { background: #FAFBFC; padding: 8px; border-bottom: 2px solid #DFE1E6; color: #6B778C; }
            .wip-tbl td { padding: 8px; border-bottom: 1px solid #DFE1E6; }
            
            .pi-prog-wrapper { background: #fff; padding: 20px; border-radius: 6px; border: 1px solid #DFE1E6; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(9,30,66,0.12); }
            .pi-prog-lbl { display: flex; justify-content: space-between; font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #172B4D; }
            .pi-prog-trk { position: relative; height: 16px; background: #EBECF0; border-radius: 8px; overflow: hidden; display: flex; }
            .pi-prog-ideal { position: absolute; top: 0; left: 0; height: 100%; background: #97A0AF; opacity: 0.4; transition: width 0.5s; }
            .pi-prog-fil { position: absolute; top: 0; left: 0; height: 100%; background: #36B37E; transition: width 0.5s ease-out; }

            .art-tooltip { position: relative; display: inline-block; cursor: help; color: #0052CC; font-weight: bold; margin-left: 4px; font-size: 11px;}
            .art-tooltip .art-tooltip-text { visibility: hidden; width: 240px; background-color: #172B4D; color: #fff; text-align: left; border-radius: 4px; padding: 8px 12px; font-size: 11px; font-weight: normal; position: absolute; z-index: 10; bottom: 130%; left: 50%; transform: translateX(-50%); opacity: 0; transition: opacity 0.2s; box-shadow: 0 4px 8px rgba(0,0,0,0.2); line-height: 1.4; white-space: normal; letter-spacing: normal; text-transform: none;}
            .art-tooltip .art-tooltip-text::after { content: ""; position: absolute; top: 100%; left: 50%; margin-left: -5px; border-width: 5px; border-style: solid; border-color: #172B4D transparent transparent transparent; }
            .art-tooltip:hover .art-tooltip-text { visibility: visible; opacity: 1; }

            .art-scroll-wrapper::-webkit-scrollbar { height: 8px; }
            .art-scroll-wrapper::-webkit-scrollbar-track { background: #FAFBFC; border-radius: 4px; }
            .art-scroll-wrapper::-webkit-scrollbar-thumb { background: #DFE1E6; border-radius: 4px; }
            .art-scroll-wrapper::-webkit-scrollbar-thumb:hover { background: #A5ADBA; }
        `;
        document.head.appendChild(style);
    },

    renderBaseHTML: function() {
        const container = document.getElementById('analyse-app-container');
        
        const p85Text = "P85 (85e percentiel) betekent dat 85% van alle items in dit aantal dagen (of sneller) is afgerond. In Agile wordt dit gezien als een zeer betrouwbare, wiskundige belofte voor de toekomst in plaats van een simpel gemiddelde.";
        const veloText = "Berekend op de semantische kwartaal/sprint naamgeving (ongeacht daadwerkelijke startdatum). Teams die zich niet aan de naamgevingsconventie houden, worden hier niet in meegenomen.";

        // FIX: <span id="velo-excluded-warn"></span> toegevoegd voor performante tooltip updates
        container.innerHTML = `
            <div id="art-dashboard">
                <div class="art-topbar">
                    <div>
                        <h2 style="margin:0; font-size:18px; color:#00B8D9;">ART FLOW DASHBOARD</h2>
                        <span style="font-size:12px; opacity:0.8;" id="art-info-text">Data wordt verwerkt...</span>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button type="button" class="art-btn" onclick="LUCAS_ANALYSE.openDiagnostics()">Diagnostiek & Debug</button>
                        <button type="button" class="art-btn" onclick="LUCAS_ANALYSE.openSettings()">Trein Instellingen</button>
                        <button type="button" class="art-btn" onclick="location.reload()">Terug</button>
                    </div>
                </div>

                <div class="pi-prog-wrapper" id="pi-progress-container"></div>

                <div class="art-grid-2">
                    <div class="art-card">
                        <h3 class="art-card-title">PI Burnup (Story Points) <span class="art-badge">→ Halen we het?</span></h3>
                        <p class="art-card-sub">Ideale lijn is o.b.v. kalenderdagen (incl. weekenden).</p>
                        <canvas id="cv-burnup" class="art-cvs"></canvas>
                    </div>
                    <div class="art-card">
                        <h3 class="art-card-title">Velocity per Sprint <span class="art-badge">~ Stabiel is beter</span></h3>
                        <p class="art-card-sub" id="velo-subtitle">Afgeronde SP per gestandaardiseerde cadans. ${this.renderTooltip(veloText)} <span id="velo-excluded-warn"></span></p>
                        <div id="velo-wrapper" class="art-scroll-wrapper" style="width:100%; overflow-x:auto; overflow-y:hidden; position:relative;">
                            <canvas id="cv-velo" style="height:240px; display:block;"></canvas>
                        </div>
                    </div>
                </div>

                <div class="art-card">
                    <h3 class="art-card-title">Trein Overzicht (CFD) <span class="art-badge">→ Balans is Beter</span></h3>
                    <p class="art-card-sub">Cumulatieve werkstroom van alle geselecteerde teams (in aantallen).</p>
                    <canvas id="cv-cfd" class="art-cvs" style="height:300px;"></canvas>
                </div>

                <div class="art-grid-2">
                    <div class="art-card">
                        <h3 class="art-card-title">Lead Time per Team <span class="art-badge">↓ Lager is Beter</span></h3>
                        <p class="art-card-sub">Gemiddelde en P85 doorlooptijd per team. ${this.renderTooltip(p85Text)}</p>
                        <canvas id="cv-lt" class="art-cvs"></canvas>
                    </div>
                    <div class="art-card">
                        <h3 class="art-card-title">Flow Efficiency per Team <span class="art-badge">↑ Hoger is Beter</span></h3>
                        <p class="art-card-sub">Percentage van de Lead Time dat actief bewerkt is (Cycle Time).</p>
                        <canvas id="cv-fe" class="art-cvs"></canvas>
                    </div>
                </div>

                <div class="art-grid-2">
                    <div class="art-card">
                        <h3 class="art-card-title">Trein Throughput <span class="art-badge">~ Stabiel is beter</span></h3>
                        <p class="art-card-sub">Aantal afgeronde issues per kalenderweek.</p>
                        <canvas id="cv-thru" class="art-cvs"></canvas>
                    </div>
                    <div class="art-card">
                        <h3 class="art-card-title">Kwaliteit (Failure Demand) <span class="art-badge">↓ Minder is Beter</span></h3>
                        <p class="art-card-sub">Verhouding Waarde vs Bugs in de afgeronde set.</p>
                        <canvas id="cv-fail" class="art-cvs"></canvas>
                    </div>
                </div>

                <div class="art-card" style="overflow:hidden;">
                    <h3 class="art-card-title">WIP Aging (Risico's) <span class="art-badge">↓ Korter is Veiliger</span></h3>
                    <p class="art-card-sub">Top 30 oudste items in de trein die op dit moment 'In Progress' staan (live leeftijd).</p>
                    <div id="wip-container" style="overflow-y:auto; height:260px;"></div>
                </div>
            </div>

            <div id="art-settings-modal" class="art-modal-bg">
                <div class="art-modal-box">
                    <div class="art-modal-header">
                        <h3 style="margin:0; color:#172B4D;">Trein Instellingen (Projecten & Teams)</h3>
                        <button type="button" class="art-modal-close" onclick="document.getElementById('art-settings-modal').style.display='none'">&times;</button>
                    </div>
                    <div class="art-modal-body">
                        <div style="background:#EBECF0; padding:15px; border-radius:4px; margin-bottom:20px;">
                            <label class="art-lbl" style="color:#172B4D;">Program Increment (PI) Timebox</label>
                            <div style="display:flex; gap:10px; margin-top:8px;">
                                <div style="flex:2"><span style="font-size:11px;">PI Naam</span><input type="text" id="art-set-pi-name" class="art-inp"></div>
                                <div style="flex:1"><span style="font-size:11px;">Start</span><input type="date" id="art-set-pi-start" class="art-inp"></div>
                                <div style="flex:1"><span style="font-size:11px;">Eind</span><input type="date" id="art-set-pi-end" class="art-inp"></div>
                            </div>
                        </div>
                        
                        <label class="art-lbl">Selecteer data voor deze weergave</label>
                        <p style="font-size:12px; color:#6B778C; margin-top:0;">Vink een project uit om alle onderliggende teams direct uit te sluiten.</p>
                        
                        <div id="art-set-hierarchy" class="art-chk-list"></div>
                        
                        <button type="button" class="art-btn-primary" onclick="LUCAS_ANALYSE.saveAndApplySettings()">Toepassen & Herberekenen</button>
                    </div>
                </div>
            </div>

            <div id="art-diag-modal" class="art-modal-bg">
                <div class="art-modal-box">
                    <div class="art-modal-header">
                        <h3 style="margin:0; color:#172B4D;">Diagnostiek & Debug</h3>
                        <button type="button" class="art-modal-close" onclick="document.getElementById('art-diag-modal').style.display='none'">&times;</button>
                    </div>
                    <div class="art-modal-body" id="art-diag-body" style="background:#F4F5F7;"></div>
                </div>
            </div>
        `;
    },

    processData: function() {
        this.hierarchy = {};
        const warnedProjects = new Set(); 

        const ty = t => { 
            const tl=(t||"").toLowerCase(); 
            if(["bug","defect"].some(x=>tl.includes(x))) return "Bug"; 
            if(["story","verhaal"].some(x=>tl.includes(x))) return "Story"; 
            if(["epic","feature"].some(x=>tl.includes(x))) return "Epic"; 
            if(["task","taak","sub-task"].some(x=>tl.includes(x))) return "Task"; 
            return "Other"; 
        };
        
        const pD = s => s ? new Date(s) : null;
        
        const dn = ["gesloten", "done", "closed", "resolved", "opgelost", "klaar", "afgerond", "verified", "accepted"];

        this.processedData = this.rawData.map(i => {
            const f = i.fields; if (!f) return null;
            
            const proj = f.project?.name || "Onbekend";
            
            let team = proj;
            const teamField = f[this.JIRA.TEAM];
            if (teamField) {
                if (teamField.value) {
                    team = teamField.value;
                } else if (typeof teamField === 'string') {
                    team = teamField; 
                } else {
                    const projKey = (i.key || "").split('-')[0];
                    if (!warnedProjects.has(projKey)) {
                        console.warn(`[ART] Onverwacht teamveld-formaat in project ${projKey} (bijv. ${i.key}). Slechts 1x gelogd per project.`, teamField);
                        warnedProjects.add(projKey);
                    }
                }
            }
            
            let sprintName = "Geen Sprint";
            const sprintField = f[this.JIRA.SPRINT_NEW] || f[this.JIRA.SPRINT_OLD] || null;
            
            if (sprintField) {
                // FIX: Pak altijd de LAATSTE sprint uit de array (de sprint waarin het issue daadwerkelijk gesloten is). 
                // Voorkomt dat issues opgelost in 2026 toegewezen worden aan een start-sprint in 2025!
                let sData = Array.isArray(sprintField) && sprintField.length > 0 ? sprintField[sprintField.length - 1] : sprintField;
                if (typeof sData === 'string') {
                    const match = sData.match(/name=([^,]+)/);
                    sprintName = match ? match[1] : sData;
                } else if (typeof sData === 'object' && sData !== null) {
                    sprintName = sData.name || sprintName;
                } else {
                    sprintName = String(sData);
                }
            } else if (f[this.JIRA.SPRINT_LEGACY]) {
                sprintName = "Sprint (Legacy)";
            }

            const epicLink = f[this.JIRA.EPIC_LINK] || null;
            
            if(!this.hierarchy[proj]) this.hierarchy[proj] = new Set();
            this.hierarchy[proj].add(team);

            const isD = dn.some(s => (f.status?.name||"").toLowerCase().includes(s));
            const c=pD(f.created), r=pD(f.resolutiondate) || (isD ? pD(f.updated) : null);
            const ds=pD(f[this.JIRA.DEV_START]), df=pD(f[this.JIRA.DEV_END_1]), dl=pD(f[this.JIRA.DEV_END_LAST]);
            
            const lt = isD ? this.daysBetween(c,r) : null;
            const ct = isD ? this.daysBetween(ds,r) : null;
            const fe = (ct !== null && lt > 0) ? (ct/lt)*100 : null;

            return {
                key: i.key, summary: f.summary, project: proj, team: team,
                t: ty(f.issuetype?.name), isD: isD, sp: parseFloat(f[this.JIRA.STORY_PTS])||0,
                sprint: sprintName,
                cadence: this.parseCadence(sprintName),
                epic: epicLink,
                c: c, r: r, ds: ds, df: df, dl: dl,
                lt: lt, ct: ct, fe: fe
            };
        }).filter(Boolean);
    },

    toggleProject: function(proj) {
        const pBox = document.getElementById(`chk-p-${proj}`);
        const isChecked = pBox.checked;
        const teamBoxes = document.querySelectorAll(`.chk-t-${proj}`);
        teamBoxes.forEach(b => b.checked = isChecked);
    },

    openSettings: function() {
        document.getElementById('art-set-pi-name').value = this.settings.piName;
        document.getElementById('art-set-pi-start').value = this.settings.piStart;
        document.getElementById('art-set-pi-end').value = this.settings.piEnd;
        
        let html = '';
        const sortedProjects = Object.keys(this.hierarchy).sort();

        sortedProjects.forEach(p => {
            const safeP = p.replace(/[^a-zA-Z0-9]/g, '');
            const pChecked = this.settings.includedProjects.includes(p) ? 'checked' : '';
            
            html += `<div class="art-proj-group">
                <label class="art-proj-lbl">
                    <input type="checkbox" id="chk-p-${safeP}" value="${this.escapeHtml(p)}" class="art-chk-master" onchange="LUCAS_ANALYSE.toggleProject('${safeP}')" ${pChecked} style="margin-right:8px;">
                    🗂️ Project: ${this.escapeHtml(p)}
                </label>
                <div class="art-team-container">`;
            
            const sortedTeams = Array.from(this.hierarchy[p]).sort();
            sortedTeams.forEach(t => {
                const tChecked = this.settings.includedTeams.includes(t) ? 'checked' : '';
                html += `<label class="art-chk-item">
                    <input type="checkbox" value="${this.escapeHtml(t)}" class="art-chk-slave chk-t-${safeP}" data-proj="${this.escapeHtml(p)}" ${tChecked}> 
                    👥 Team: ${this.escapeHtml(t)}
                </label>`;
            });
            html += `</div></div>`;
        });

        document.getElementById('art-set-hierarchy').innerHTML = html;
        document.getElementById('art-settings-modal').style.display = 'block';
    },

    saveAndApplySettings: function() {
        this.settings.piName = document.getElementById('art-set-pi-name').value.trim();
        this.settings.piStart = document.getElementById('art-set-pi-start').value;
        this.settings.piEnd = document.getElementById('art-set-pi-end').value;
        
        this.settings.includedProjects = [];
        this.settings.includedTeams = [];

        const masters = document.querySelectorAll('.art-chk-master');
        masters.forEach(m => {
            if (m.checked) this.settings.includedProjects.push(m.value);
        });

        const slaves = document.querySelectorAll('.art-chk-slave');
        slaves.forEach(s => {
            if (s.checked) this.settings.includedTeams.push(s.value);
        });

        this.saveSettings();
        document.getElementById('art-settings-modal').style.display = 'none';
        this.applyFilters();
    },

    applyFilters: function() {
        const pSet = new Set(this.settings.includedProjects);
        const tSet = new Set(this.settings.includedTeams);
        
        let piS = this.settings.piStart ? new Date(this.settings.piStart).getTime() : 0;
        let piE = this.settings.piEnd ? new Date(this.settings.piEnd).getTime() : Date.now();

        this.filteredData = this.processedData.filter(d => pSet.has(d.project) && tSet.has(d.team));
        
        // FIX: piData is strikt begrensd voor CFD, Burnup en Velocity
        this.piData = this.filteredData.filter(d => {
            if(!d.isD) {
                if(this.settings.piEnd && d.c && d.c.getTime() > piE) return false;
                if(this.settings.piStart && d.c && d.c.getTime() < piS) return false;
                return true; 
            }
            return d.r != null && d.r.getTime() >= piS && d.r.getTime() <= piE;
        });

        // FIX: Aparte wipData array voor de openstaande risico's (genegeerd door PI filters)
        this.wipData = this.filteredData.filter(d => !d.isD);

        this.activeTeams = Array.from(new Set(this.piData.map(d=>d.team)));

        document.getElementById('art-info-text').textContent = `Trein: ${pSet.size} projecten | ${tSet.size} teams | PI: ${this.settings.piName || "Alles"} (${this.piData.length} issues in scope)`;
        this.drawCharts();
    },

    getCanvasContext: function(id) { 
        const c = document.getElementById(id); if(!c) return null;
        const r = c.getBoundingClientRect(); if(r.width === 0) return null; 
        c.width = r.width * 2; c.height = r.height * 2; 
        const ctx = c.getContext("2d"); ctx.scale(2,2); 
        ctx._w = r.width; ctx._h = r.height; return ctx; 
    },
    
    getAxisTicks: function(m, h, t) { 
        const s = Math.max(1, Math.ceil(m/5)); 
        const r = []; 
        for(let v = 0; v < m + s*0.5; v += s) r.push({v, y: t + h*(1 - v/m)}); 
        return r; 
    },

    drawCharts: function() {
        this.drawPiProgress();
        this.drawBurnup();
        this.drawVelocity();
        this.drawCFD();
        this.drawLeadTime();
        this.drawFlowEfficiency();
        this.drawThroughput();
        this.drawQuality();
        this.drawAging();
    },

    drawPiProgress: function() {
        const c = document.getElementById('pi-progress-container');
        if(!c) return;

        let totSP = 0;
        let doneSP = 0;

        this.piData.forEach(d => {
            totSP += d.sp;
            if (d.isD) doneSP += d.sp;
        });

        if (totSP === 0) {
            c.innerHTML = `<div style="color:#6B778C; font-size:12px;">Geen Story Points (SP) gevonden in de geselecteerde set.</div>`;
            return;
        }

        const actPct = Math.round((doneSP / totSP) * 100);
        let idealPct = 0;

        if (this.settings.piStart && this.settings.piEnd) {
            const msStart = new Date(this.settings.piStart).getTime();
            const msEnd = new Date(this.settings.piEnd).getTime();
            const msNow = Date.now();
            
            if (msNow >= msEnd) {
                idealPct = 100;
            } else if (msNow > msStart) {
                const totalDays = (msEnd - msStart);
                const passedDays = (msNow - msStart);
                idealPct = Math.round((passedDays / totalDays) * 100);
            }
        }

        const idealInfo = idealPct > 0 ? `<span style="font-size:11px; font-weight:normal; color:#6B778C; margin-left:8px;">Ideale lijn: ${idealPct}%</span>` : '';

        c.innerHTML = `
            <div class="pi-prog-lbl">
                <span>PI Voortgang: ${this.escapeHtml(this.settings.piName) || "Gehele Periode"} ${idealInfo}</span>
                <span style="color:#0052CC;">${Math.round(doneSP)} / ${Math.round(totSP)} SP (${actPct}%)</span>
            </div>
            <div class="pi-prog-trk">
                <div class="pi-prog-ideal" style="width: ${idealPct}%;"></div>
                <div class="pi-prog-fil" style="width: ${actPct}%;"></div>
            </div>
        `;
    },

    drawBurnup: function() {
        const cc = this.getCanvasContext('cv-burnup'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);

        const dta = this.piData;
        if(!dta.length) return;

        const totalScope = dta.reduce((a,b)=>a+b.sp, 0);
        
        if (totalScope === 0) {
            cc.fillStyle = "#172B4D"; cc.font = "bold 12px sans-serif"; cc.textAlign = "center";
            cc.fillText("Geen scope (Story Points) gevonden voor Burnup.", cW/2, cH/2);
            return;
        }

        let mD = this.settings.piStart ? new Date(this.settings.piStart).getTime() : 
            dta.reduce((min, d) => Math.min(min, d.c ? d.c.getTime() : Date.now()), Infinity);
            
        let xD = this.settings.piEnd ? new Date(this.settings.piEnd).getTime() : 
            dta.reduce((max, d) => Math.max(max, d.isD && d.r ? d.r.getTime() : (d.c ? d.c.getTime() : Date.now())), 0);
        
        let todayMax = Math.min(Date.now(), xD);
        if(mD >= todayMax) todayMax = mD + 86400000;
        
        const drTotal = xD - mD;
        const drPassed = todayMax - mD;
        
        const dyPassed = Math.max(1, Math.min(Math.ceil(drPassed/86400000), 100));
        const dsPassed = drPassed/dyPassed;
        
        const sortedDone = dta.filter(d => d.isD && d.r).sort((a,b) => a.r.getTime() - b.r.getTime());
        let ptr = 0;
        let cumSP = 0;
        const pts = [];
        
        for(let i=0; i<=dyPassed; i++){ 
            const t = mD + i*dsPassed;
            while(ptr < sortedDone.length && sortedDone[ptr].r.getTime() <= t) {
                cumSP += sortedDone[ptr].sp;
                ptr++;
            }
            pts.push(cumSP);
        }

        const mC = Math.max(totalScope, 1) * 1.1; 
        const tk = this.getAxisTicks(mC, cH-50, 20);
        const xO = t => 40 + ((t-mD)/drTotal) * (cW-50);
        const yO = v => 20 + (1-v/mC) * (cH-50);

        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="right";
        tk.forEach(t=>{ cc.fillText(Math.round(t.v), 30, t.y); cc.beginPath(); cc.moveTo(35,t.y); cc.lineTo(cW,t.y); cc.strokeStyle="#DFE1E6"; cc.stroke(); });

        cc.beginPath(); cc.moveTo(xO(mD), yO(0)); cc.lineTo(xO(xD), yO(totalScope));
        cc.strokeStyle = "rgba(151, 160, 175, 0.4)"; cc.lineWidth = 2; cc.stroke();

        cc.beginPath(); cc.moveTo(40, yO(totalScope)); cc.lineTo(cW, yO(totalScope));
        cc.strokeStyle = "#97A0AF"; cc.lineWidth = 2; cc.setLineDash([5,5]); cc.stroke(); cc.setLineDash([]);
        
        cc.fillStyle = "#172B4D"; cc.textAlign="left"; cc.font="bold 10px sans-serif";
        cc.fillText(`Scope: ${Math.round(totalScope)} SP`, 45, yO(totalScope) - 8);

        cc.beginPath();
        pts.forEach((p, i) => {
            const x = xO(mD + i*dsPassed);
            const y = yO(p);
            if (i===0) cc.moveTo(x,y); else cc.lineTo(x,y);
        });
        cc.strokeStyle = "#0052CC"; cc.lineWidth = 3; cc.stroke();
        
        const currentDone = pts[pts.length-1] || 0;
        const lastX = xO(todayMax);
        const lastY = yO(currentDone);
        
        cc.beginPath();
        cc.arc(lastX, lastY, 4, 0, 2*Math.PI);
        cc.fillStyle = "#fff"; cc.fill();
        cc.lineWidth = 2; cc.strokeStyle = "#0052CC"; cc.stroke();

        if (todayMax < xD && drPassed > 0) {
            const velPerMs = currentDone / drPassed;
            const projectedTotal = currentDone + (velPerMs * (xD - todayMax));
            
            cc.beginPath(); cc.moveTo(lastX, lastY); cc.lineTo(xO(xD), yO(projectedTotal));
            cc.strokeStyle = "#36B37E"; cc.lineWidth = 2; cc.setLineDash([4,4]); cc.stroke(); cc.setLineDash([]);
            
            cc.fillStyle = "#36B37E"; cc.textAlign="right"; cc.font="bold 10px sans-serif";
            let progY = yO(projectedTotal) - 8;
            if (Math.abs(yO(projectedTotal) - yO(totalScope)) < 15) {
                progY = yO(projectedTotal) + 12;
            }
            cc.fillText(`Prognose: ${Math.round(projectedTotal)}`, xO(xD) - 5, progY);
        }

        cc.textAlign="center"; cc.fillStyle="#6B778C"; cc.font="11px sans-serif";
        for(let i=0; i<=5; i++){ const ts=mD+(i/5)*drTotal; cc.fillText(new Date(ts).toLocaleDateString("nl-NL",{month:"short",day:"numeric"}), xO(ts), cH-12); }
    },

    drawVelocity: function() {
        const dn = this.piData.filter(d => d.isD && d.r && d.cadence !== null);
        
        const bk = {};
        dn.forEach(x => {
            if (!bk[x.cadence]) bk[x.cadence] = 0;
            bk[x.cadence] += x.sp;
        });

        const srt = Object.keys(bk)
            .sort((a, b) => this.parseSortVal(a) - this.parseSortVal(b))
            .map(k => ({ s: k, v: bk[k] }));

        const wrapper = document.getElementById('velo-wrapper');
        const cvs = document.getElementById('cv-velo');
        if (!wrapper || !cvs) return;
        
        cvs.style.width = '100%';
        const reqW = Math.max(wrapper.clientWidth, srt.length * 80);
        cvs.style.width = reqW + 'px';
        
        const cc = this.getCanvasContext('cv-velo'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);

        // FIX: Gebruik een span-element om tooltip HTML-vervuiling (en haperingen) te voorkomen
        const excludedSP = this.piData
            .filter(d => d.isD && d.r && d.cadence === null && d.sprint !== "Geen Sprint")
            .reduce((sum, d) => sum + d.sp, 0);

        const warnSpan = document.getElementById('velo-excluded-warn');
        if (warnSpan) {
            if (excludedSP > 0) {
                warnSpan.textContent = ` Let op: ${Math.round(excludedSP)} SP genegeerd door onherkenbare sprintnamen (zie Diagnostiek).`;
                warnSpan.style.color = "#FF8B00";
                warnSpan.style.fontWeight = "bold";
            } else {
                warnSpan.textContent = "";
            }
        }

        if(!srt.length) {
            cc.fillStyle = "#6B778C"; cc.font = "12px sans-serif"; cc.textAlign = "center";
            cc.fillText("Geen issues met herkende sprint-cadans gevonden.", cW/2, cH/2);
            return;
        }
        
        const mC = Math.max(...srt.map(b => b.v), 1) * 1.1;
        const tk = this.getAxisTicks(mC, cH-50, 20);

        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="right";
        tk.forEach(t=>{ 
            cc.fillText(Math.round(t.v), 25, t.y); 
            cc.beginPath(); cc.moveTo(30,t.y); cc.lineTo(cW,t.y); 
            cc.strokeStyle="#DFE1E6"; cc.stroke(); 
        });

        const st = (cW - 40) / srt.length;
        const bw = Math.max(4, st * 0.6);
        
        srt.forEach((b, i) => { 
            const x = 35 + i*st + (st-bw)/2; 
            const h = (b.v / mC) * (cH-50); 
            cc.fillStyle = "#6554C0";
            cc.fillRect(x, cH-30-h, bw, h); 
            
            cc.fillStyle = "#172B4D"; cc.textAlign="center"; cc.font="bold 10px sans-serif";
            cc.fillText(Math.round(b.v), x + bw/2, cH-30-h - 5);
        });

        cc.textAlign="center"; cc.fillStyle="#6B778C"; cc.font="10px sans-serif";
        srt.forEach((b, i) => {
            cc.fillText(b.s, 35 + i*st + st/2, cH-12);
        });
    },

    drawCFD: function() {
        const cc = this.getCanvasContext('cv-cfd'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);
        
        const dta = this.piData;
        if(!dta.length) { cc.fillText("Geen data", cW/2, cH/2); return; }

        const cK = ["c","ds","df","dl","r"];
        const cl = ["#DFE1E6","#4C9AFF","#ABF5D1","#36B37E","#172B4D"];
        
        let mD = Infinity, xD = 0;
        if (this.settings.piStart) mD = new Date(this.settings.piStart).getTime();
        if (this.settings.piEnd) xD = new Date(this.settings.piEnd).getTime();
        
        if (mD === Infinity || xD === 0) {
            dta.forEach(d => {
               cK.forEach(k => {
                   if (d[k] instanceof Date) {
                       const t = d[k].getTime();
                       if (!this.settings.piStart && t < mD) mD = t;
                       if (!this.settings.piEnd && t > xD) xD = t;
                   }
               });
            });
        }
        
        let todayMax = Math.min(Date.now(), xD);
        if(mD >= todayMax) todayMax = mD + 86400000;

        const drPassed = todayMax - mD;
        const drTotal = xD - mD;
        const dy = Math.min(Math.ceil(drPassed/86400000), 100);
        const ds = drPassed/dy;
        
        const sortedData = {};
        cK.forEach(k => {
            sortedData[k] = dta.filter(d => d[k] instanceof Date).map(d => d[k].getTime()).sort((a,b) => a - b);
        });
        
        const ptrs = { c:0, ds:0, df:0, dl:0, r:0 };
        const pts = [];
        
        for(let i=0; i<=dy; i++) {
            const t = mD + i*ds;
            const p = {};
            cK.forEach(k => {
                const arr = sortedData[k];
                while(ptrs[k] < arr.length && arr[ptrs[k]] <= t) { ptrs[k]++; }
                p[k] = ptrs[k];
            });
            pts.push(p);
        }
        
        const mC = Math.max(...pts.map(p=>p.c),1);
        const tk = this.getAxisTicks(mC, cH-50, 20);
        const xO = t => 40 + ((t-mD)/drTotal)*(cW-50);
        const yO = v => 20 + (1-v/mC)*(cH-50);
        
        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="right";
        tk.forEach(t=>{ cc.fillText(Math.round(t.v), 30, t.y); cc.beginPath(); cc.moveTo(35,t.y); cc.lineTo(cW,t.y); cc.strokeStyle="#DFE1E6"; cc.stroke(); });
        
        for(let j=0; j<cK.length; j++){
            cc.beginPath(); cc.moveTo(xO(mD), cH-30); 
            for(let i=0;i<=dy;i++) cc.lineTo(xO(mD+i*ds),yO(pts[i][cK[j]]));
            cc.lineTo(xO(mD+dy*ds), cH-30); cc.closePath();
            cc.fillStyle=cl[j]; cc.fill(); 
            cc.beginPath();
            for(let i=0;i<=dy;i++) i===0 ? cc.moveTo(xO(mD+i*ds),yO(pts[i][cK[j]])) : cc.lineTo(xO(mD+i*ds),yO(pts[i][cK[j]]));
            cc.strokeStyle = cl[j]; cc.stroke();
        }

        cc.lineWidth = 1;

        cc.textAlign="center"; cc.fillStyle="#6B778C";
        for(let i=0; i<=5; i++){ const ts=mD+(i/5)*drTotal; cc.fillText(new Date(ts).toLocaleDateString("nl-NL",{month:"short",day:"numeric"}), xO(ts), cH-12); }
    },

    drawLeadTime: function() {
        const minRowH = 28;
        const neededH = Math.max(260, this.activeTeams.length * minRowH + 60);
        const el = document.getElementById('cv-lt');
        if (el) el.style.height = neededH + 'px';

        const cc = this.getCanvasContext('cv-lt'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);

        const tMap = {};
        this.activeTeams.forEach(t => tMap[t] = []);
        
        const dn = this.piData.filter(d => d.isD && d.lt !== null);
        dn.forEach(d => { if(tMap[d.team]) tMap[d.team].push(d.lt); });
        
        const tArr = Object.keys(tMap).sort();
        if(!tArr.length) return;

        const stats = tArr.map(t => {
            const arr = tMap[t];
            return { 
                t: t, 
                avg: arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0, 
                p85: arr.length ? this.calculatePercentile(arr, 85) : 0,
                hasData: arr.length > 0
            };
        });

        const mL = 110, mR = 20, mT = 30, mB = 30;
        const maxV = Math.max(...stats.map(s => s.p85)) * 1.1 || 10;
        
        const tickStep = Math.max(1, Math.ceil(maxV/5));
        const ticks = [];
        for(let v=0; v < maxV + tickStep*0.5; v+=tickStep) {
            ticks.push({v: v, x: mL + (v/maxV)*(cW - mL - mR)});
        }

        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="center";
        ticks.forEach(t => { 
            cc.fillText(Math.round(t.v), t.x, cH - 10); 
            cc.beginPath(); cc.moveTo(t.x, mT); cc.lineTo(t.x, cH - mB); 
            cc.strokeStyle="#DFE1E6"; cc.stroke(); 
        });

        const rowH = (cH - mT - mB) / stats.length;
        const bH = Math.min(rowH * 0.6, 30); 

        stats.forEach((s, i) => {
            const yCenter = mT + i * rowH + rowH/2;
            
            cc.fillStyle = "#172B4D"; cc.textAlign = "right"; cc.font = "11px sans-serif";
            const shortName = s.t.length > 15 ? s.t.substring(0,13)+'..' : s.t;
            cc.fillText(shortName, mL - 10, yCenter + 4);

            if (s.hasData) {
                const w85 = (s.p85/maxV) * (cW - mL - mR);
                const wAvg = (s.avg/maxV) * (cW - mL - mR);
                cc.fillStyle = "rgba(0, 82, 204, 0.2)"; cc.fillRect(mL, yCenter - bH/2, w85, bH);
                cc.fillStyle = "#0052CC"; cc.fillRect(mL, yCenter - bH/2, wAvg, bH); 
            } else {
                cc.fillStyle = "#EBECF0"; cc.fillRect(mL, yCenter - bH/2, 40, bH);
                cc.fillStyle = "#97A0AF"; cc.textAlign = "left"; cc.fillText("N/A", mL + 5, yCenter + 4);
            }
        });
        
        cc.textAlign="left";
        cc.fillStyle = "rgba(0, 82, 204, 0.2)"; cc.fillRect(mL, 5, 10, 10); cc.fillStyle="#6B778C"; cc.fillText("P85", mL + 15, 14);
        cc.fillStyle = "#0052CC"; cc.fillRect(mL + 60, 5, 10, 10); cc.fillStyle="#6B778C"; cc.fillText("Gemiddeld", mL + 75, 14);
    },

    drawFlowEfficiency: function() {
        const minRowH = 28;
        const neededH = Math.max(260, this.activeTeams.length * minRowH + 60);
        const el = document.getElementById('cv-fe');
        if (el) el.style.height = neededH + 'px';

        const cc = this.getCanvasContext('cv-fe'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);

        const tMap = {};
        this.activeTeams.forEach(t => tMap[t] = []);

        const dn = this.piData.filter(d => d.isD && d.fe !== null);
        dn.forEach(d => { if(tMap[d.team]) tMap[d.team].push(d.fe); });
        
        const tArr = Object.keys(tMap).sort();
        if(!tArr.length) return;

        const stats = tArr.map(t => {
            const arr = tMap[t];
            return { 
                t: t, 
                avg: arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0,
                hasData: arr.length > 0 
            };
        });

        const mL = 110, mR = 20, mT = 30, mB = 30;
        
        const ticks = [];
        for(let v=0; v<=100; v+=20) {
            ticks.push({v: v, x: mL + (v/100)*(cW - mL - mR)});
        }

        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="center";
        ticks.forEach(t => { 
            cc.fillText(t.v + "%", t.x, cH - 10); 
            cc.beginPath(); cc.moveTo(t.x, mT); cc.lineTo(t.x, cH - mB); 
            cc.strokeStyle="#DFE1E6"; cc.stroke(); 
        });

        const x15 = mL + (15/100)*(cW - mL - mR);
        const x40 = mL + (40/100)*(cW - mL - mR);
        
        cc.beginPath(); cc.moveTo(x15, mT); cc.lineTo(x15, cH - mB);
        cc.strokeStyle = "rgba(255, 86, 48, 0.4)"; cc.setLineDash([5,5]); cc.lineWidth = 2; cc.stroke(); cc.setLineDash([]);
        cc.fillStyle = "#FF5630"; cc.textAlign="left"; cc.fillText("Gevarenzone", x15 + 4, mT + 10);
        cc.lineWidth = 1;

        cc.beginPath(); cc.moveTo(x40, mT); cc.lineTo(x40, cH - mB);
        cc.strokeStyle = "rgba(54, 179, 126, 0.4)"; cc.setLineDash([5,5]); cc.lineWidth = 2; cc.stroke(); cc.setLineDash([]);
        cc.fillStyle = "#36B37E"; cc.textAlign="left"; cc.fillText("Gezond", x40 + 4, mT + 10);
        cc.lineWidth = 1;

        const rowH = (cH - mT - mB) / stats.length;
        const bH = Math.min(rowH * 0.6, 30);

        stats.forEach((s, i) => {
            const yCenter = mT + i * rowH + rowH/2;
            
            cc.fillStyle = "#172B4D"; cc.textAlign = "right"; cc.font = "11px sans-serif";
            const shortName = s.t.length > 15 ? s.t.substring(0,13)+'..' : s.t;
            cc.fillText(shortName, mL - 10, yCenter + 4);

            if (s.hasData) {
                const wAvg = (s.avg/100) * (cW - mL - mR);
                cc.fillStyle = s.avg < 15 ? "#FF5630" : (s.avg > 40 ? "#36B37E" : "#FFAB00");
                cc.fillRect(mL, yCenter - bH/2, wAvg, bH);
                
                cc.fillStyle = "#172B4D"; cc.textAlign="left"; cc.font="bold 10px sans-serif";
                cc.fillText(Math.round(s.avg) + "%", mL + wAvg + 5, yCenter + 4);
            } else {
                cc.fillStyle = "#EBECF0"; cc.fillRect(mL, yCenter - bH/2, 40, bH);
                cc.fillStyle = "#97A0AF"; cc.textAlign = "left"; cc.fillText("N/A", mL + 5, yCenter + 4);
            }
        });
    },

    drawThroughput: function() {
        const cc = this.getCanvasContext('cv-thru'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);
        
        const dn = this.piData.filter(d => d.isD && d.r);
        if(!dn.length) return;

        const bk = {};
        dn.forEach(x => {
            const dt = new Date(x.r); dt.setHours(0,0,0,0);
            dt.setDate(dt.getDate() - ((dt.getDay()+6)%7)); 
            const k = dt.getTime(); 
            if(!bk[k]) bk[k] = { d: new Date(k), c: 0 };
            bk[k].c++;
        });

        const srt = Object.values(bk).sort((a,b)=>a.d - b.d);
        const mC = Math.max(...srt.map(b=>b.c),1)*1.1;
        const tk = this.getAxisTicks(mC,cH-50,20);
        
        cc.fillStyle="#6B778C"; cc.font="11px sans-serif"; cc.textAlign="right";
        tk.forEach(t=>{ cc.fillText(Math.round(t.v), 25, t.y); cc.beginPath(); cc.moveTo(30,t.y); cc.lineTo(cW,t.y); cc.strokeStyle="#DFE1E6"; cc.stroke(); });
        
        const st=(cW-40)/srt.length, bw=Math.max(1,st*0.6);
        srt.forEach((b,i)=>{ 
            let x=35+i*st+(st-bw)/2; 
            const h=(b.c/mC)*(cH-50); 
            cc.fillStyle = "#36B37E";
            cc.fillRect(x,cH-30-h,bw,h); 
            
            cc.fillStyle = "#172B4D"; cc.textAlign="center"; cc.font="bold 10px sans-serif";
            cc.fillText(b.c, x + bw/2, cH-30-h - 5);
        });
        
        cc.textAlign="center"; cc.fillStyle="#6B778C";
        const stepX = Math.max(1, Math.ceil(srt.length / 5));
        for(let i=0; i<srt.length; i+=stepX) {
            cc.fillText(srt[i].d.toLocaleDateString("nl-NL",{month:"short",day:"numeric"}), 35+i*st+st/2, cH-12);
        }
    },

    drawQuality: function() {
        const cc = this.getCanvasContext('cv-fail'); if(!cc) return;
        const cW = cc._w, cH = cc._h; cc.clearRect(0,0,cW,cH);

        const dn = this.piData.filter(d => d.isD && (d.t==="Bug" || d.t==="Story" || d.t==="Epic"));
        const bugs = dn.filter(d => d.t === "Bug").length;
        const total = dn.length;
        if(total === 0) return;

        const pBug = bugs/total;
        const r = Math.min(cW, cH)/3;
        const cx = cW/2 - 40, cy = cH/2;

        cc.beginPath(); cc.moveTo(cx,cy); cc.arc(cx, cy, r, 0, pBug * 2 * Math.PI); cc.fillStyle = this.colors.Bug; cc.fill();
        cc.beginPath(); cc.moveTo(cx,cy); cc.arc(cx, cy, r, pBug * 2 * Math.PI, 2 * Math.PI); cc.fillStyle = this.colors.Story; cc.fill();
        
        cc.beginPath(); cc.arc(cx, cy, r*0.6, 0, 2*Math.PI); cc.fillStyle = "#fff"; cc.fill();
        cc.fillStyle = "#172B4D"; cc.textAlign="center"; cc.font="bold 20px sans-serif";
        cc.fillText(`${(pBug*100).toFixed(0)}%`, cx, cy+6);

        cc.textAlign="left"; cc.font="12px sans-serif";
        cc.fillStyle = this.colors.Bug; cc.fillRect(cW-110, cy-20, 12, 12); cc.fillStyle="#172B4D"; cc.fillText(`Bugs (${bugs})`, cW-90, cy-10);
        cc.fillStyle = this.colors.Story; cc.fillRect(cW-110, cy+5, 12, 12); cc.fillStyle="#172B4D"; cc.fillText(`Waarde (${total-bugs})`, cW-90, cy+15);
    },

    drawAging: function() {
        const now = new Date();
        const wip = this.wipData.map(d => {
            const liveAge = this.daysBetween(d.ds || d.c, now);
            return { ...d, liveAge };
        }).filter(d => d.liveAge !== null && d.liveAge > 0);
        
        wip.sort((a,b) => b.liveAge - a.liveAge);
        const top = wip.slice(0, 30); 

        const c = document.getElementById('wip-container');
        if(!top.length) { c.innerHTML = "<div style='color:#36B37E; padding:10px;'>Geen vastgeroeste items in geselecteerde filter.</div>"; return; }

        let h = `<table class="wip-tbl"><thead><tr><th>Key</th><th>Team</th><th style="text-align:right">Dagen Open</th></tr></thead><tbody>`;
        top.forEach(d => {
            const color = d.liveAge > 30 ? "#FF5630" : (d.liveAge > 14 ? "#FF8B00" : "#172B4D");
            h += `<tr>
                <td style="font-family:monospace; color:#0052CC;">${this.escapeHtml(d.key)}</td>
                <td>${this.escapeHtml(d.team)}</td>
                <td style="text-align:right; font-weight:bold; color:${color};">${Math.round(d.liveAge)}</td>
            </tr>`;
        });
        h += `</tbody></table>`;
        c.innerHTML = h;
    },

    openDiagnostics: function() {
        const bd = document.getElementById('art-diag-body');
        
        const rRw = (l, v) => `<div class="r-row"><span style="color:#6B778C;font-weight:600;">${l}</span><span class="r-val">${v}</span></div>`;
        const pCt = (n, t) => t > 0 ? `${n} <span style="color:#6B778C; font-size:10px;">(${Math.round(n/t*100)}%)</span>` : `${n} <span style="color:#6B778C; font-size:10px;">(n/a)</span>`;

        let hasDS = 0, hasDE = 0, cntSp = 0, cntSpNew = 0, cntSpOld = 0;
        let cntParsedSprint = 0, cntValidCadence = 0, cntOrphanSprint = 0;
        let orphanMap = {};
        
        let sampleSprintField = "Geen sprint velden gevonden in de data.";

        this.rawData.forEach(d => {
            if(d.fields[this.JIRA.DEV_START]) hasDS++;
            if(d.fields[this.JIRA.DEV_END_1]) hasDE++;
            if(d.fields[this.JIRA.STORY_PTS]) cntSp++;
            if(d.fields[this.JIRA.SPRINT_NEW]) {
                cntSpNew++;
                if (sampleSprintField.startsWith("Geen")) {
                    sampleSprintField = JSON.stringify(d.fields[this.JIRA.SPRINT_NEW], null, 2);
                }
            }
            if(d.fields[this.JIRA.SPRINT_OLD]) {
                cntSpOld++;
                if (sampleSprintField.startsWith("Geen")) {
                    sampleSprintField = JSON.stringify(d.fields[this.JIRA.SPRINT_OLD], null, 2);
                }
            }
        });

        this.processedData.forEach(d => {
            if (d.sprint !== "Geen Sprint" && d.sprint !== "Sprint (Legacy)") {
                cntParsedSprint++;
                if (d.cadence !== null) {
                    cntValidCadence++;
                } else {
                    cntOrphanSprint++;
                    if (!orphanMap[d.team]) orphanMap[d.team] = new Set();
                    orphanMap[d.team].add(d.sprint);
                }
            }
        });

        let h = `<div class="art-grid-2">`;
        
        h += `<div class="art-card" style="margin-bottom:0;"><h4 style="margin:0 0 10px 0; color:#0052CC;">Data Context</h4>
            ${rRw('Totaal opgehaald', this.rawData.length)}
            ${rRw('Filter: Binnen PI/Actief', this.piData.length)}
            ${rRw('PI Naam', this.settings.piName || "Alles")}
            ${rRw('Aantal Projecten in Trein', this.settings.includedProjects.length)}
            ${rRw('Aantal Teams in Trein', this.settings.includedTeams.length)}
        </div>`;

        h += `<div class="art-card" style="margin-bottom:0;"><h4 style="margin:0 0 10px 0; color:#0052CC;">Kwaliteit (MT velden)</h4>
            ${rRw('Met "Dev Start" gevuld', pCt(hasDS, this.rawData.length))}
            ${rRw('Met "Dev End" gevuld', pCt(hasDE, this.rawData.length))}
            <div style="font-size:11px; color:#6B778C; margin-top:10px;">Als Dev Start/End missen, kunnen Cycle Time en Flow Efficiency niet berekend worden.</div>
        </div>`;

        let orphanHtml = "";
        if (Object.keys(orphanMap).length > 0) {
            orphanHtml = `<div style="margin-top:15px; border-top:1px solid #DFE1E6; padding-top:15px;">
                <span style="display:block; font-size:12px; font-weight:700; color:#FF5630; margin-bottom:8px;">Actiepunt voor Scrum Masters: Teams met afwijkende sprintnamen</span>
                <div style="background:#FFEBE6; padding:10px; border-radius:4px; font-size:11px; color:#DE350B; max-height:150px; overflow-y:auto; border: 1px solid #FFBDAD;">`;
            
            Object.entries(orphanMap).sort((a,b) => a[0].localeCompare(b[0])).forEach(([team, sprints]) => {
                orphanHtml += `<div style="margin-bottom:6px;"><strong style="color:#172B4D;">${this.escapeHtml(team)}:</strong> ${Array.from(sprints).map(s => this.escapeHtml(s)).join(', ')}</div>`;
            });
            orphanHtml += `</div></div>`;
        }

        h += `<div class="art-card" style="grid-column:1/-1; margin-top:20px; background:#E9F2FF; border-color:#4C9AFF;">
            <h4 style="margin:0 0 10px 0; color:#0052CC;">Sprint Debugging</h4>
            <div class="art-grid-2">
                <div>
                    ${rRw('Issues met SP > 0', cntSp)}
                    ${rRw(`Issues met veld ${this.JIRA.SPRINT_NEW}`, cntSpNew)}
                    ${rRw(`Issues met veld ${this.JIRA.SPRINT_OLD}`, cntSpOld)}
                    ${rRw('Succesvol geparseerde Sprints (Naam aanwezig)', pCt(cntParsedSprint, this.rawData.length))}
                    ${rRw('Sprints met geldige cadans (Y/Q/S)', pCt(cntValidCadence, cntParsedSprint))}
                    ${rRw('Orphan Sprints (onherkenbare naamgeving)', pCt(cntOrphanSprint, cntParsedSprint))}
                </div>
                <div>
                    <span style="display:block; font-size:11px; font-weight:600; color:#6B778C; margin-bottom:4px;">Voorbeeld van Sprint Payload (Uit issue data):</span>
                    <textarea readonly style="width:100%; height:100px; font-family:monospace; font-size:11px; padding:8px; border:1px solid #DFE1E6; border-radius:4px; outline:none; background:#1e1e1e; color:#a9b7c6;">${this.escapeHtml(sampleSprintField)}</textarea>
                </div>
            </div>
            ${orphanHtml}
        </div>`;

        const sample = this.processedData.slice(0, 15).map(d => 
            `"${d.key}","${d.t}","${this.escapeHtml(d.sprint)}","${this.escapeHtml(d.team)}",${d.lt||""},${d.ct||""}`
        ).join('\n');

        h += `<div class="art-card" style="grid-column:1/-1; margin-top:0;"><h4 style="margin:0 0 10px 0; color:#0052CC;">Data Sample (Eerste 15)</h4>
            <textarea readonly style="width:100%; height:120px; font-family:monospace; font-size:11px; padding:8px; border:1px solid #DFE1E6; outline:none; background:#FAFBFC;">key,type,sprint,team,lead_time,cycle_time\n${sample}</textarea>
        </div>`;

        h += `</div>`;
        
        bd.innerHTML = h;
        document.getElementById('art-diag-modal').style.display = 'block';
    }
};