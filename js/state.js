/**
 * Central application state.
 *
 * All mutations must go through `dispatch()` in actions.js so that
 * the combinatorial solver and the UI always stay in sync.
 * This module is dependency-free to avoid circular imports.
 */
export const State = {
    /** Raw JSON payload from unterrichte.json. Populated during init. */
    data: null,

    /** IDs of modules the user has explicitly pinned to the schedule. */
    fixedSelection: new Set(),

    /**
     * Selection-order tag for each fixed module, keyed by module ID — the
     * value it held in `selectionCounter` at the moment it was picked.
     * Combined with each `wildcardRequests` entry's own `.seq` (see below),
     * this lets `Logic.mergeBySelectionOrder()` interleave fixed modules and
     * wildcard-resolved modules into a single "as chosen" order for display,
     * instead of always showing fixed modules before wildcards regardless of
     * which was actually picked first.
     * @type {Map<number, number>}
     */
    fixedSeq: new Map(),

    /**
     * Monotonically increasing counter, the shared clock behind `fixedSeq`
     * and `wildcardRequests[i].seq`. Incremented once per new fixed pick or
     * wildcard activation — never decremented, only reset to 0 alongside a
     * full selection reset (see `resetSelections()` in actions.js).
     * @type {number}
     */
    selectionCounter: 0,

    /**
     * Open wildcard slots — one entry per Fach/Stufe where any module is acceptable.
     * `seq` records the `selectionCounter` value at activation time (see `fixedSeq` above).
     * @type {Array<{fach: string, stufe: string, modules: object[], seq: number}>}
     */
    wildcardRequests: [],

    /** All valid module combinations computed for the current wildcard set. */
    combinations: [],

    /** Index into `combinations` currently displayed on the grid. */
    comboIdx: 0,

    allowOverlap: true,
    allowFern:    true,
    allowQuer:    true,

    /** Active panel on mobile — 'schedule' | 'sidebar'. */
    mobileView: 'schedule',

    /** Persisted scroll offset of the accordion, restored when switching back to sidebar. */
    sidebarScrollPos: 0,

    /**
     * Class → module mapping used by the Klassenstundenpläne section.
     * Shape: { [semester|'Schnellspur']: { [className]: Module[] } }
     */
    classesMap: {},

    /**
     * All valid wildcard combinations, pre-computed by the solver.
     * Each entry: { modules: Module[], internalOvl: number }
     */
    globalWildcardCombos: [],

    /**
     * Undo stack — each entry is a plain-object snapshot of schedule state,
     * including which wildcard variant (if any) was pinned to the front of
     * the list (`frontComboIds`) and the browsing offset from there
     * (`comboIdx`), plus the selection-order bookkeeping (`fixedSeq`,
     * `selectionCounter`) needed to keep module chips in "as chosen" order
     * after undo/redo. Populated by History.push() before every
     * user-initiated mutation.
     * @type {Array<{ fixedSelection: Set<number>, fixedSeq: Map<number, number>,
     *                selectionCounter: number, wildcardRequests: Array,
     *                frontComboIds: number[]|null, comboIdx: number }>}
     */
    history: [],

    /**
     * Redo stack — cleared on every new History.push(), populated by History.undo().
     * @type {Array<{ fixedSelection: Set<number>, fixedSeq: Map<number, number>,
     *                selectionCounter: number, wildcardRequests: Array,
     *                frontComboIds: number[]|null, comboIdx: number }>}
     */
    future: [],

    /** O(1) lookup by module name. */
    moduleByName: new Map(),

    /** Dense array indexed by module.id for O(1) lookup. */
    moduleById: [],

    /** All preprocessed modules in insertion order. */
    modules: [],

    /** Total module count — used as the stride for the flat N×N matrices. */
    totalModules: 0,

    /**
     * Flat Uint8Array of size N×N storing pairwise slot-overlap counts.
     * Access: overlapMatrix[a.id * N + b.id]
     */
    overlapMatrix: null,

    /**
     * Flat Uint8Array of size N×N flagging exception pairs (1 = exempt from overlap rule).
     * Access: exceptionMatrix[a.id * N + b.id]
     */
    exceptionMatrix: null,
};
