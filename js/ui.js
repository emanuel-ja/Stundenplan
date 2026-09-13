import { CONFIG } from './config.js';
import { State }  from './state.js';
import { Logic }  from './logic.js';

/** WildCard Symbol */
const WILDCARD_SYMBOL = '⠕';

/**
 * Maps accordion header `<button>` elements to their lazy content factories.
 * Using a WeakMap avoids storing callbacks as expando properties on DOM nodes.
 * @type {WeakMap<HTMLElement, () => HTMLElement>}
 */
const accordionCallbacks = new WeakMap();

/**
 * Returns a pill badge `<span>` for Fernstudium or Quereinsteiger modules,
 * or `null` for regular modules.
 * @param {{ isFern: boolean, isQuer: boolean }} module
 * @returns {HTMLSpanElement|null}
 */
function createModuleBadge(module) {
    if (!module.isFern && !module.isQuer) return null;
    const badge = document.createElement('span');
    badge.className = module.isFern
        ? 'module-badge module-badge--fern'
        : 'module-badge module-badge--quer';
    badge.textContent = module.isFern ? 'Fern' : 'Quer';
    return badge;
}
/**
 * Returns the CSS BEM modifier class for a Fernstudium or Quereinsteiger
 * module, or an empty string for regular modules.
 * Consumed by any render function that needs to colour-code modules by type.
 * @param {{ isFern: boolean, isQuer: boolean }} module
 * @returns {string}
 */
function getModuleTypeClass(module) {
    if (module.isFern) return 'micro-chip--fern';
    if (module.isQuer) return 'micro-chip--quer';
    return '';
}

/**
 * Returns `true` when a module is currently displayed as part of a WildCard
 * (–beliebig) selection, i.e. it was not explicitly pinned by the user but
 * resolved from an open wildcard request.
 *
 * A module counts as a wildcard module when:
 *   1. It is NOT in the explicit fixed selection, AND
 *   2. There is an open wildcard request matching its Fach and Stufe.
 *
 * @param {{ id: number, fach_lang: string, stufe: string|number }} module
 * @returns {boolean}
 */
function isWildcardModule(module) {
    if (State.fixedSelection.has(module.id)) return false;
    return State.wildcardRequests.some(
        w => w.fach === module.fach_lang && w.stufe == module.stufe
    );
}

/**
 * Converts a 1-based JSON day value (Mo=1 … Fr=5) to the 0-based grid column
 * index used in cell IDs (cell-0 … cell-4).
 * @param {number} tag - Day value from the JSON schedule entry.
 * @returns {number}
 */
function tagToDay(tag) {
    return tag - 1;
}

export const UI = {

    // ── Top-level render ─────────────────────────────────────────────────────

    /**
     * Master render routine. Synchronises the entire UI to the current state.
     * Called after every state mutation via `dispatch()` in actions.js.
     */
    renderAll() {
        this.updateSidebar();

        const hasCombos = State.combinations.length > 0;
        document.getElementById('combination-controls').classList.toggle('hidden', !hasCombos);
        if (hasCombos) this.updateComboInfo();

        const modulesToRender = Logic.getDisplayedModules();
        this.renderSchedule(modulesToRender);
        this.updateStatusText(modulesToRender);
    },

    // ── Sidebar state sync ───────────────────────────────────────────────────

    /**
     * Syncs sidebar list-item CSS classes (selected / conflict / wildcard-active)
     * with the current application state.
     * Only touches class lists — no DOM structure is rebuilt.
     */
    updateSidebar() {
        const currentFixedArray = Array.from(State.fixedSelection).map(id => State.moduleById[id]);

        // Memoised per-render so isModuleViable isn't called more than once per module.
        const viabilityCache = new Map();
        const isViable = (mObj) => {
            if (!viabilityCache.has(mObj.id)) {
                viabilityCache.set(mObj.id, Logic.isModuleViable(mObj, currentFixedArray));
            }
            return viabilityCache.get(mObj.id);
        };

        for (const mObj of State.modules) {
            const li = document.getElementById(`li-${mObj.name}`);
            if (!li) continue;
            const isFixed = State.fixedSelection.has(mObj.id);
            li.classList.toggle('selected', isFixed);
            li.classList.toggle('conflict', !isFixed && !isViable(mObj));
        }

        for (const [fach, stufen] of Object.entries(State.data?.Pflichtfach ?? {})) {
            for (const [stufe, modules] of Object.entries(stufen)) {
                if (modules.length <= 1 || CONFIG.NO_WILDCARD_FAECHER.includes(fach)) continue;
                const li = document.getElementById(`wildcard-${fach}-${stufe}`);
                if (!li) continue;

                const isActive = State.wildcardRequests.some(w => w.fach === fach && w.stufe === stufe);
                li.classList.toggle('wildcard-active', isActive);
                li.classList.toggle('conflict', !isActive && !modules.some(m => isViable(m)));
            }
        }
    },

    // ── Schedule grid ────────────────────────────────────────────────────────

    /**
     * Clears and redraws all module blocks on the schedule grid.
     *
     * Strategy:
     * 1. Collect all slot entries grouped by cell key + position.
     * 2. Split full-slot entries into top+bottom buckets when a half-slot
     *    is already present in the same cell, so they don't overlap visually.
     * 3. Render one block per bucket, merging names/teachers for conflicts.
     *
     * @param {object[]} modules
     */
    renderSchedule(modules) {
        document.querySelectorAll('.module-block').forEach(b => b.remove());

        // Pass 1: group raw entries by cell key.
        /** @type {Map<string, Array<{name, lehrer, pos, day, tIdx}>>} */
        const cellMap = new Map();
        for (const m of modules) {
            for (const entry of m.schedule) {
                const timeIdx = UI.getTimeIndex(entry.beginn);
                if (timeIdx === -1) continue;
                const key = `${tagToDay(entry.tag)}-${timeIdx}`;
                if (!cellMap.has(key)) cellMap.set(key, []);
                cellMap.get(key).push({
                    name: m.name, lehrer: m.lehrer,
                    pos: UI._resolvePosition(entry),
                    day: tagToDay(entry.tag), tIdx: timeIdx,
                });
            }
        }

        // Pass 2: split full-slot entries when halves are present, then merge.
        /** @type {Map<string, {names: string[], teachers: string[], pos, day, tIdx}>} */
        const cellGroups = new Map();
        for (const [cellKey, entries] of cellMap) {
            const hasHalf = entries.some(e => e.pos === 'top' || e.pos === 'bottom');
            for (const e of entries) {
                const positions = (e.pos === 'full' && hasHalf) ? ['top', 'bottom'] : [e.pos];
                for (const pos of positions) {
                    const gKey = `${cellKey}-${pos}`;
                    if (!cellGroups.has(gKey)) {
                        cellGroups.set(gKey, { names: [], teachers: [], pos, day: e.day, tIdx: e.tIdx });
                    }
                    const g = cellGroups.get(gKey);
                    g.names.push(e.name);
                    g.teachers.push(e.lehrer);
                }
            }
        }

        // Pass 3: render.
        for (const cellData of cellGroups.values()) {
            const cell = document.getElementById(`cell-${cellData.day}-${cellData.tIdx}`);
            if (!cell) continue;

            const uniqueNames    = [...new Set(cellData.names)];
            const uniqueTeachers = [...new Set(cellData.teachers)];

            const block = document.createElement('div');
            block.className = `module-block ${UI._positionClass(cellData.pos)}`;

            // Mark as conflict when multiple non-exception modules share a slot.
            if (uniqueNames.length > 1) {
                const m1 = State.moduleByName.get(uniqueNames[0]);
                const m2 = State.moduleByName.get(uniqueNames[1]);
                if (!(uniqueNames.length === 2 && m1 && m2 && Logic.isEx(m1.id, m2.id))) {
                    block.classList.add('is-conflict');
                }
            }

            const strong = document.createElement('strong');
            strong.textContent = uniqueNames.join(' / ');
            block.appendChild(strong);
            block.appendChild(document.createElement('br'));
            block.appendChild(document.createTextNode(uniqueTeachers.join(' / ')));

            cell.appendChild(block);
        }
    },

    // ── Status bar ───────────────────────────────────────────────────────────

    /**
     * Renders the module status bar above the grid.
     * Each active module gets a chip with a remove button.
     * Removal is handled via delegated event in main.js (data-action="remove-module").
     * @param {object[]} modules
     */
    updateStatusText(modules) {
        const statusDiv = document.getElementById('current-status');
        statusDiv.innerHTML = '';

        if (modules.length === 0) {
            statusDiv.innerHTML = '<span class="text-muted fw-bold">Keine Module gewählt.</span>';
            return;
        }

        const label = document.createElement('span');
        label.className   = 'status-label';
        label.textContent = `${modules.length} ${modules.length === 1 ? 'Modul' : 'Module'}:`;
        statusDiv.appendChild(label);

        // Chips erscheinen in der Reihenfolge, in der die Module aktuell in
        // `modules` stehen (Einfüge- bzw. Auflösungsreihenfolge aus
        // Logic.getDisplayedModules()) — bewusst NICHT alphabetisch sortiert.
        modules.forEach(m => {
            const chip = document.createElement('span');
            const typeClass = getModuleTypeClass(m);
            chip.className = typeClass ? `micro-chip ${typeClass}` : 'micro-chip';
            chip.dataset.mname  = m.name;  // read by the delegated click handler

            if (isWildcardModule(m)) {
                const symbolSpan = document.createElement('span');
                symbolSpan.className   = 'micro-chip-wildcard-symbol';
                symbolSpan.textContent = `${WILDCARD_SYMBOL}\u00A0`;
                chip.appendChild(symbolSpan);
            }
            chip.appendChild(document.createTextNode(m.name));

            const removeBtn = document.createElement('button');
            removeBtn.className         = 'micro-chip-remove';
            removeBtn.innerHTML         = '✕';
            removeBtn.dataset.action    = 'remove-module';
            removeBtn.setAttribute('aria-label', `${m.name} entfernen`);

            chip.appendChild(removeBtn);
            statusDiv.appendChild(chip);
        });
    },

    /** Refreshes the "Varianten (x/y)" counter. */
    updateComboInfo() {
        document.getElementById('combo-info').textContent =
            `Varianten (${State.comboIdx + 1}/${State.combinations.length})`;
    },

    // ── Grid construction ────────────────────────────────────────────────────

    /** Populates the static 6-row × 5-column time grid. Called once on init. */
generateGrid() {
        const grid = document.getElementById('schedule-grid');
        const fragment = document.createDocumentFragment(); // Fragment is added to the DOM once at the end

        CONFIG.TIMES.forEach((startTime, i) => {
            const [h, m] = startTime.split(':').map(Number);
            const endM   = m + 45;
            const endH   = h + Math.floor(endM / 60);
            const endTime = `${String(endH).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;

            const label = document.createElement('div');
            label.className = 'grid-cell time-label flex flex-col items-center justify-center text-center';
            label.innerHTML = `<span class="hour-number">${i}</span><span class="time-range">${startTime}<br>–<br>${endTime}</span>`;
            fragment.appendChild(label);

            for (let d = 0; d < 5; d++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.id        = `cell-${d}-${i}`;
                fragment.appendChild(cell);
            }
        });

        grid.appendChild(fragment); // <--  DOM
    },

    // ── Sidebar construction ─────────────────────────────────────────────────

    /**
     * Builds the Pflicht/Frei accordion sections. Called once on init.
     * Content is rendered lazily when the user first expands an accordion.
     */
    renderInitialSidebar() {
        const pflichtDiv = document.getElementById('pflicht-content');
        const freiDiv    = document.getElementById('frei-content');

        for (const [fach, stufen] of Object.entries(State.data.Pflichtfach)) {
            pflichtDiv.appendChild(UI.createAccordion(fach, () => UI._buildFachContent(fach, stufen)));
        }

        for (const [langname, modules] of Object.entries(State.data['Nicht-Pflichtfach'] ?? {})) {
            freiDiv.appendChild(UI.createAccordion(langname, () => UI._buildFreiContent(modules)));
        }
    },

    /**
     * Builds the accordion content for a Pflichtfach.
     * Single-Stufe fächer get a flat list; multi-Stufe fächer get a tab widget.
     * @param {string} fach
     * @param {object} stufen  Map from Stufe key → Module[].
     * @returns {HTMLElement}
     */
    _buildFachContent(fach, stufen) {
        const wrap = document.createElement('div');
        const stufenKeys = Object.keys(stufen).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        );

        if (stufenKeys.length === 1) {
            const pane = document.createElement('div');
            pane.style.paddingTop = '5px';
            pane.appendChild(UI.renderModuleList(stufen[stufenKeys[0]], fach, stufenKeys[0]));
            wrap.appendChild(pane);
            return wrap;
        }

        const tabsHeader  = document.createElement('div');
        tabsHeader.className = 'tabs-header flex w-full';
        const tabsContent = document.createElement('div');
        tabsContent.className = 'tabs-content';

        stufenKeys.forEach((stufe, index) => {
            const isFirst = index === 0;

            const btn = document.createElement('button');
            btn.className   = `tab-btn flex items-center justify-center truncate${isFirst ? ' active' : ''}`;
            btn.textContent = stufe;

            const pane = document.createElement('div');
            pane.className = `tab-pane${isFirst ? ' active' : ''}`;
            pane.appendChild(UI.renderModuleList(stufen[stufe], fach, stufe));

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Array.from(tabsHeader.children).forEach(b => b.classList.remove('active'));
                Array.from(tabsContent.children).forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                pane.classList.add('active');
            });

            tabsHeader.appendChild(btn);
            tabsContent.appendChild(pane);
        });

        wrap.appendChild(tabsHeader);
        wrap.appendChild(tabsContent);
        return wrap;
    },

    /**
     * Builds the accordion content for a Freigegenstand.
     * Renders a flat module list without a wildcard option.
     * @param {object[]} modules
     * @returns {HTMLElement}
     */
    _buildFreiContent(modules) {
        const wrap = document.createElement('div');
        wrap.style.paddingTop = '5px';
        wrap.appendChild(UI.renderModuleList(modules));
        return wrap;
    },

    /** Builds the Klassenstundenpläne accordion section. Called once on init. */
    renderClassesSidebar() {
        const klassenDiv = document.getElementById('klassen-content');
        if (!klassenDiv) return;
        klassenDiv.textContent = '';

        const semesters = Object.keys(State.classesMap)
            .filter(k => k !== 'Schnellspur')
            .map(Number)
            .sort((a, b) => a - b);

        for (const sem of semesters) {
            klassenDiv.appendChild(UI.createAccordion(`Semester ${sem}`, () => UI._buildClassList(sem)));
        }
        if (State.classesMap['Schnellspur']) {
            klassenDiv.appendChild(UI.createAccordion('Schnellspur', () => UI._buildClassList('Schnellspur')));
        }
    },

    /**
     * @param {string|number} semester
     * @returns {HTMLElement}
     */
    _buildClassList(semester) {
        const ul = document.createElement('ul');
        ul.className = 'item-list';

        Object.keys(State.classesMap[semester])
            .sort((a, b) => a.localeCompare(b))
            .forEach(className => {
                const li = document.createElement('li');
                const strong = document.createElement('strong');
                strong.textContent = `Klasse ${className}`;
                li.appendChild(strong);
                li.appendChild(document.createTextNode(' übernehmen'));
                li.dataset.action    = 'apply-class';
                li.dataset.classname = className;
                li.dataset.semester  = semester;
                ul.appendChild(li);
            });

        const wrap = document.createElement('div');
        wrap.appendChild(ul);
        return wrap;
    },

    /**
     * Creates a `<ul>` of module items, optionally prefixed with a wildcard row.
     * Each `<li>` carries data attributes consumed by the delegated click handler.
     * @param {object[]}    modules
     * @param {string|null} [fach]
     * @param {string|null} [stufe]
     * @returns {HTMLUListElement}
     */
    renderModuleList(modules, fach = null, stufe = null) {
        const ul = document.createElement('ul');
        ul.className = 'item-list';

        if (fach && stufe && modules.length > 1 && !CONFIG.NO_WILDCARD_FAECHER.includes(fach)) {
            const shortName = modules[0]?.name?.match(/^[^\d]+/)?.[0] ?? fach;
            const li = document.createElement('li');
            li.id           = `wildcard-${fach}-${stufe}`;
            li.dataset.action = 'toggle-wildcard';
            li.dataset.fach   = fach;
            li.dataset.stufe  = stufe;
            li.textContent    = `${WILDCARD_SYMBOL} ${shortName}${stufe} – beliebig`;
            ul.appendChild(li);
        }

        for (const m of modules) {
            const li = document.createElement('li');
            li.id             = `li-${m.name}`;
            li.dataset.action = 'toggle-fixed';
            li.dataset.mname  = m.name;
            if (fach)  li.dataset.fach  = fach;
            if (stufe) li.dataset.stufe = stufe;

            const badge = createModuleBadge(m);

            li.appendChild(document.createTextNode(`${m.name} (${m.lehrer})`));
            if (badge) li.appendChild(badge);

            ul.appendChild(li);
        }
        return ul;
    },

    /**
     * Creates a lazily-rendered accordion wrapper.
     * `contentCb` is stored in a WeakMap and invoked only on first expansion.
     * @param {string}              title
     * @param {() => HTMLElement}   contentCb
     * @returns {HTMLElement}
     */
    createAccordion(title, contentCb) {
        const wrap = document.createElement('div');

        const btn = document.createElement('button');
        btn.className   = 'accordion-header';
        btn.textContent = title;
        accordionCallbacks.set(btn, contentCb);

        const content = document.createElement('div');
        content.className = 'accordion-content';

        wrap.appendChild(btn);
        wrap.appendChild(content);
        return wrap;
    },

    /**
     * Expands or collapses an accordion header.
     * Content is rendered lazily on the first open.
     * @param {HTMLElement} header
     */
    toggleAccordion(header) {
        const content = header.nextElementSibling;
        if (!content?.classList.contains('accordion-content')) return;

        if (!content.hasChildNodes()) {
            const cb = accordionCallbacks.get(header);
            if (cb) content.appendChild(cb());
        }
        content.classList.toggle('active');
        header.classList.toggle('active');
        UI.updateSidebar();
    },

    /** Collapses all open accordions and resets tab selections to the first tab. */
    collapseAllAccordions() {
        document.querySelectorAll('.accordion-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.accordion-header').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tabs-header').forEach(header => {
            Array.from(header.children).forEach((btn, i) => btn.classList.toggle('active', i === 0));
        });
        document.querySelectorAll('.tabs-content').forEach(content => {
            Array.from(content.children).forEach((pane, i) => pane.classList.toggle('active', i === 0));
        });
    },

    // ── Hover preview ─────────────────────────────────────────────────────────

    /**
     * Overlays a striped frame on the grid slots of module `m`.
     * Used to preview the position of a conflicting (greyed-out) module on hover.
     * @param {object} m
     */
    showPreview(m) {
        UI.hidePreview();
        for (const entry of m.schedule) {
            const timeIdx = UI.getTimeIndex(entry.beginn);
            if (timeIdx === -1) continue;
            const cell = document.getElementById(`cell-${tagToDay(entry.tag)}-${timeIdx}`);
            if (!cell) continue;

            const frame = document.createElement('div');
            frame.className = `module-preview-frame ${UI._positionClass(UI._resolvePosition(entry))}`;
            cell.appendChild(frame);
        }
    },

    hidePreview() {
        document.querySelectorAll('.module-preview-frame:not(.fade-out)').forEach(frame => {
            frame.classList.add('fade-out');
            setTimeout(() => frame.remove(), 400);
        });
    },

    // ── Info Tooltips ─────────────────────────────────────────────────────────

    /**
     * Initialises the (i) info buttons in the sidebar toggles.
     * Desktop: show on hover; Mobile/touch: show on click.
     * A single fixed-position tooltip element is appended to <body> so it
     * escapes overflow:hidden containers like .sidebar-inner.
     */
    initInfoTooltips() {
        const TEXTS = {
            overlap: 'Bei Präsenzstudienmodulen mit mindestens drei Wochenstunden kann eine Überschneidung im Ausmaß von höchstens einer Wochenstunde zugelassen werden. Solche Überschneidungen werden im Stundenplan rot hinterlegt.',
            fern:    'Bei Fernstudienmodulen findet die Hälfte der vorgesehenen Unterrichtszeit als Präsenzunterricht vor Ort statt, die andere Hälfte entfällt auf Eigenarbeit einschließlich Hausübungen. Beachte bitte, dass Religion und Ethik derzeit nur als Fernstudium angeboten werden.',
            quer:    'Für Studierende aus höheren Klassen eines Gymnasiums oder einer BHS (z. B. HAK, HTL) gibt es spezielle Quereinsteigermodule. Sie haben einen geringeren Wochenstundenumfang als die regulären Module, da sie nur den Differenzstoff behandeln.',
        };

        // Create the global tooltip element once
        const tip = document.createElement('div');
        tip.id = 'info-tooltip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);

        let currentBtn = null;
        let hideTimer  = null;

        /** Position the tooltip near a given button, staying within the viewport. */
        function position(btn) {
            // Force layout so offsetWidth/Height are accurate
            tip.style.visibility = 'hidden';
            tip.classList.add('visible');
            const tW  = tip.offsetWidth;
            const tH  = tip.offsetHeight;
            tip.classList.remove('visible');
            tip.style.visibility = '';

            const r   = btn.getBoundingClientRect();
            const vpW = window.innerWidth;
            const vpH = window.innerHeight;
            const GAP = 10;

            // Preferred: right of button
            let left = r.right + GAP;
            let top  = r.top + r.height / 2 - tH / 2;

            // Overflow right → place left of button
            if (left + tW > vpW - GAP) {
                left = r.left - tW - GAP;
            }
            // Still overflows left (narrow screen) → center below button
            if (left < GAP) {
                left = Math.max(GAP, Math.min(r.left, vpW - tW - GAP));
                top  = r.bottom + GAP;
            }

            // Clamp vertically
            top = Math.max(GAP, Math.min(top, vpH - tH - GAP));

            tip.style.left = `${Math.round(left)}px`;
            tip.style.top  = `${Math.round(top)}px`;
        }

        function show(btn) {
            clearTimeout(hideTimer);
            const key = btn.dataset.infoKey;
            tip.textContent = TEXTS[key] ?? '';
            position(btn);
            tip.classList.add('visible');
            if (currentBtn && currentBtn !== btn) currentBtn.classList.remove('active');
            btn.classList.add('active');
            currentBtn = btn;
        }

        function hide() {
            tip.classList.remove('visible');
            if (currentBtn) { currentBtn.classList.remove('active'); currentBtn = null; }
        }

        /** True when the primary pointing device cannot hover (touch-only). */
        const touchOnly = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

        document.querySelectorAll('.info-btn').forEach(btn => {
            // Desktop hover
            btn.addEventListener('mouseenter', () => { if (!touchOnly()) show(btn); });
            btn.addEventListener('mouseleave', () => {
                if (!touchOnly()) {
                    // Small delay so the cursor can move onto the tooltip without it vanishing
                    hideTimer = setTimeout(hide, 80);
                }
            });

            // Click / tap toggle (works on both desktop and mobile)
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentBtn === btn && tip.classList.contains('visible')) {
                    hide();
                } else {
                    show(btn);
                }
            });
        });

        // Click anywhere else closes the tooltip
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.info-btn')) hide();
        });

        // Reposition on scroll / resize in case the button moves
        window.addEventListener('resize', () => { if (currentBtn) position(currentBtn); });
        document.addEventListener('scroll', () => { if (currentBtn) position(currentBtn); }, true);
    },

    // ── Theme ────────────────────────────────────────────────────────────────

    /** @param {boolean} isDark */
    applyTheme(isDark) {
        if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
        else        document.documentElement.removeAttribute('data-theme');
    },

    // ── Mobile layout ─────────────────────────────────────────────────────────

    /** Updates slide-in/slide-out classes and nav button states for the mobile layout. */
    updateMobileView() {
        const sidebar     = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        const isMobile    = window.innerWidth <= 768;

        if (!isMobile) {
            sidebar.classList.remove('mobile-hidden', 'slide-left', 'slide-right', 'slide-active');
            mainContent.classList.remove('mobile-hidden', 'slide-left', 'slide-right', 'slide-active');
            return;
        }

        const isSchedule = State.mobileView === 'schedule';

        sidebar.classList.remove('mobile-hidden', 'slide-left', 'slide-right', 'slide-active');
        mainContent.classList.remove('mobile-hidden', 'slide-left', 'slide-right', 'slide-active');

        // Schedule (main-content) is the permanent base layer — no class needed.
        // Sidebar slides in as a left-side overlay; only add slide-active when visible.
        if (!isSchedule) sidebar.classList.add('slide-active');

        document.getElementById('nav-btn-schedule')?.classList.toggle('active', isSchedule);
        document.getElementById('nav-btn-sidebar')?.classList.toggle('active', !isSchedule);

        if (!isSchedule) {
            const acc = document.getElementById('accordion-container');
            if (acc) requestAnimationFrame(() => { acc.scrollTop = State.sidebarScrollPos; });
        }
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Syncs the disabled/enabled state of the undo and redo buttons.
     * Called by History.push(), pop(), undo(), and redo().
     */
    updateHistoryButtons() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = State.history.length === 0;
        if (redoBtn) redoBtn.disabled = State.future.length  === 0;
    },

    /**
     * Returns the grid-row index for a given time string by scanning backwards.
     * @param {string} timeStr - "HH:MM"
     * @returns {number} Index into CONFIG.TIMES, or -1 if before the first slot.
     */
    getTimeIndex(timeStr) {
        for (let i = CONFIG.TIMES.length - 1; i >= 0; i--) {
            if (timeStr >= CONFIG.TIMES[i]) return i;
        }
        return -1;
    },

    /**
     * @param {string} timeStr - "HH:MM"
     * @returns {number} Minutes since midnight.
     */
    timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    },

    /**
     * Determines which vertical half of a slot a schedule entry occupies.
     * @param {object} entry
     * @returns {'top'|'bottom'|'full'}
     */
    _resolvePosition(entry) {
        if (!entry.ist_halbe_stunde) return 'full';
        const slotStart = CONFIG.TIMES[UI.getTimeIndex(entry.beginn)];
        return UI.timeToMinutes(entry.beginn) - UI.timeToMinutes(slotStart) > 15
            ? 'bottom' : 'top';
    },

    /**
     * @param {'top'|'bottom'|'full'} pos
     * @returns {string} CSS class name.
     */
    _positionClass(pos) {
        if (pos === 'top')    return 'half-unit';
        if (pos === 'bottom') return 'half-unit-bottom';
        return 'full-unit';
    },
};
