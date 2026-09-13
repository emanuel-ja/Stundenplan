import { State }           from './state.js';
import { Logic }           from './logic.js';
import { UI }              from './ui.js';
import { Actions, dispatch } from './actions.js';
import { History }         from './history.js';
import { requestModuleData } from './passwordGate.js';

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init() {
    UI.generateGrid();

    // Blocks here until the correct password is entered — see passwordGate.js.
    // The gate itself shows retry errors for wrong passwords, so a rejection
    // here only happens for a fatal problem (data file missing/corrupt),
    // which mirrors the previous loadData() failure handling below.
    try {
        State.data = await requestModuleData();
    } catch (err) {
        document.getElementById('current-status').textContent =
            `Fehler: ${err.message}`;
        return;
    }

    Logic.preprocessData();
    UI.renderInitialSidebar();
    UI.renderClassesSidebar();

    const themeToggle = document.getElementById('theme-toggle-chk');
    if (themeToggle) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        themeToggle.checked = prefersDark;
        UI.applyTheme(prefersDark);
    }

    setupEventListeners();
    UI.initInfoTooltips();

    requestAnimationFrame(() => {
        requestAnimationFrame(() => UI.updateMobileView());
    });
}

// ─── Event listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
    setupDelegatedClicks();
    setupDelegatedChanges();
    setupTitleField();
    setupSwipeGesture();
    setupKeyboardShortcuts();
    setupPreviewHover();
    setupSystemColorScheme();
    setupViewportListeners();
}

/**
 * Handles all click events via delegation from document.
 * Having a single listener keeps the sidebar list performant.
 */
function setupDelegatedClicks() {
    document.addEventListener('click', (e) => {
        const target = e.target;

        // ── Toolbar buttons ──────────────────────────────────────────────────
        if (target.closest('#btn-undo'))             { History.undo();            return; }
        if (target.closest('#btn-redo'))             { History.redo();            return; }
        if (target.closest('#btn-export-pdf'))       { Actions.exportPDF();          return; }
        if (target.closest('#btn-reset-schedule'))   { Actions.resetSchedule();       return; }
        if (target.closest('#btn-prev-combo'))       { Actions.prevCombo();           return; }
        if (target.closest('#btn-next-combo'))       { Actions.nextCombo();           return; }
        if (target.closest('#btn-apply-combo'))      { Actions.applyCurrentCombo();   return; }
        if (target.closest('#btn-impressum'))        { Actions.showImpressum();       return; }

        // ── Mobile navigation ────────────────────────────────────────────────
        if (target.closest('#nav-btn-schedule')) { Actions.switchMobileView('schedule'); return; }
        if (target.closest('#nav-btn-sidebar'))  { Actions.switchMobileView('sidebar');  return; }

        // ── Chip remove button ───────────────────────────────────────────────
        if (target.closest('[data-action="remove-module"]')) {
            const mname = target.closest('.micro-chip')?.dataset.mname;
            if (mname) Actions.removeModule(State.moduleByName.get(mname));
            return;
        }

        // ── Accordion headers ────────────────────────────────────────────────
        const accHeader = target.closest('.accordion-header');
        if (accHeader?.nextElementSibling?.classList.contains('accordion-content')) {
            UI.toggleAccordion(accHeader);
            return;
        }

        // ── Sidebar list items ───────────────────────────────────────────────
        const li = target.closest('.item-list li');
        if (li && !li.classList.contains('conflict')) {
            const { action, classname, semester, fach, stufe, mname } = li.dataset;
            if (action === 'apply-class')      Actions.applyClassSchedule(classname, semester);
            if (action === 'toggle-wildcard')  Actions.toggleWildcard(fach, stufe, State.data.Pflichtfach[fach][stufe]);
            if (action === 'toggle-fixed')     Actions.toggleFixedModule(State.moduleByName.get(mname), fach, stufe);
        }
    });
}

/** Handles checkbox changes for filters and the theme toggle. */
function setupDelegatedChanges() {
    document.addEventListener('change', (e) => {
        switch (e.target.id) {
            case 'allow-overlap-chk':     Actions.toggleAllowOverlap();    break;
            case 'allow-fern-chk':        Actions.toggleAllowFern();       break;
            case 'allow-quer-chk':        Actions.toggleAllowQuer();       break;
            case 'theme-toggle-chk':      UI.applyTheme(e.target.checked); break;
        }
    });
}

/** Clears the placeholder text on focus and restores it on blur if empty. */
function setupTitleField() {
    const titleEl = document.getElementById('schedule-title');
    if (!titleEl) return;
    const placeholder = titleEl.value;

    titleEl.addEventListener('focus', () => {
        if (titleEl.value.trim() === placeholder) titleEl.value = '';
    });
    titleEl.addEventListener('blur', () => {
        if (titleEl.value.trim() === '') titleEl.value = placeholder;
        titleEl.setSelectionRange(0, 0);
    });
    titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    });
}

/** Swipe left/right on the app container to switch between schedule and sidebar. */
function setupSwipeGesture() {
    const container = document.querySelector('.app-container');
    if (!container) return;

    let startX = 0, startY = 0;

    container.addEventListener('touchstart', (e) => {
        startX = e.changedTouches[0].screenX;
        startY = e.changedTouches[0].screenY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (window.innerWidth > 768) return;
        const dx = e.changedTouches[0].screenX - startX;
        const dy = e.changedTouches[0].screenY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
            if (dx > 0 && State.mobileView === 'schedule') Actions.switchMobileView('sidebar');
            if (dx < 0 && State.mobileView === 'sidebar')  Actions.switchMobileView('schedule');
        }
    }, { passive: true });
}

/**
 * Listens for viewport changes and updates the mobile layout only when the
 * viewport WIDTH changes (e.g. orientation flip).
 *
 * Height-only changes — caused by the browser URL bar appearing or
 * disappearing — are intentionally ignored.  The layout is anchored to
 * 100svh which is the stable "small viewport" height, so there is nothing
 * to reflow on a height change.
 *
 * visualViewport.resize is used in addition to window.resize because some
 * mobile browsers fire one but not the other.
 */
function setupViewportListeners() {
    let lastWidth = window.innerWidth;

    const onResize = () => {
        const w = window.innerWidth;
        if (w !== lastWidth) {
            lastWidth = w;
            UI.updateMobileView();
        }
    };

    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
}

/** Arrow keys and Enter to navigate and apply combinations. Ctrl+Z/Y for undo/redo. */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // ── Undo / Redo ───────────────────────────────────────────────────────
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); History.undo(); return; }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); History.redo(); return; }
        }

        // ── Combination navigation ────────────────────────────────────────────
        const comboUI = document.getElementById('combination-controls');
        if (State.combinations.length === 0 || comboUI.classList.contains('hidden')) return;
        if (e.key === 'ArrowRight') Actions.nextCombo();
        else if (e.key === 'ArrowLeft') Actions.prevCombo();
        else if (e.key === 'Enter') Actions.applyCurrentCombo();
    });
}

/**
 * Hold (pointerdown) on a conflicting sidebar item to preview its grid position.
 * Releasing or leaving the element hides the preview.
 */
function setupPreviewHover() {
    document.addEventListener('pointerdown', (e) => {
        const li = e.target.closest('.item-list li.conflict');
        if (li?.dataset.action === 'toggle-fixed') {
            UI.showPreview(State.moduleByName.get(li.dataset.mname));
        }
    });

    const endPreview = (e) => {
        const li = e.target.closest('.item-list li');
        if ((li && !li.contains(e.relatedTarget)) || (!li && document.querySelector('.module-preview-frame'))) {
            UI.hidePreview();
        }
    };
    ['pointerup', 'pointercancel', 'pointerout'].forEach(evt => document.addEventListener(evt, endPreview));

    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.item-list li')) e.preventDefault();
    });
}

/** Syncs the theme toggle when the OS colour scheme changes. */
function setupSystemColorScheme() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const toggle = document.getElementById('theme-toggle-chk');
        if (toggle) toggle.checked = e.matches;
        UI.applyTheme(e.matches);
    });
}

init();
