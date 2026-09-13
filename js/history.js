import { State } from './state.js';
import { Logic } from './logic.js';
import { UI }    from './ui.js';
import { CONFIG } from './config.js';

/**
 * Undo/Redo history for user-facing schedule mutations.
 *
 * Tracked state: fixedSelection, fixedSeq, selectionCounter, wildcardRequests,
 * allowOverlap, allowFern, allowQuer.
 * The three filter flags are included so that redo cannot silently re-introduce
 * module types that the user has since disabled (e.g. re-adding a Fern module
 * after the "Fernstudienmodule wählbar" toggle has been turned off).
 * `fixedSeq`/`selectionCounter` (see state.js) restore the "as chosen" order
 * `Logic.mergeBySelectionOrder()` needs for chip display — without them, a
 * module re-picked after an undo would get a fresh, present-day order stamp
 * instead of the one it actually had at snapshot time.
 * The Dark-Mode toggle is intentionally excluded — it is a pure display preference.
 *
 * Each snapshot also records which variant was pinned to the front of
 * `State.combinations` (if any) and the browsing offset (`comboIdx`) from
 * there, so undo/redo restore not just the schedule's module selection but
 * the precise variant *and its position* the user was looking at (e.g.
 * "5/20" stays "5/20") — without needing to store the full variant list.
 *
 * This works because `State.combinations` always has a very constrained
 * shape: `Logic.calculateCombinations()` rebuilds it from scratch in one
 * fixed default order on every dispatch — a pure function of
 * (fixedSelection, wildcardRequests, filters) alone — and each dispatch's
 * `afterUpdate` hook calls `Logic.bringMatchingComboToFront()` at most once
 * afterwards (see actions.js), which moves at most one variant to index 0.
 * Browsing (Actions.nextCombo/prevCombo) only ever changes `comboIdx`, never
 * the array itself. So at any moment, `State.combinations` is exactly "the
 * default order, with at most one variant pulled to the front" — a single,
 * cheap-to-record delta (which variant is at index 0) plus a plain index.
 *
 * Recomputing from the restored fixedSelection/wildcardRequests alone would
 * only reproduce the default order, not that delta — so `frontComboIds`
 * records which variant (by module IDs, a few numbers) was at index 0, and
 * `_restoreComboDisplay()` re-applies `Logic.bringMatchingComboToFront()`
 * with it after the recompute, then sets `comboIdx` on top. Same mechanism
 * as the live UI, just re-targeted at what the snapshot had pinned instead
 * of at what's currently displayed — which is what keeps undo from
 * incorrectly re-pinning to index 0 the way a live mutation would.
 *
 * Usage pattern:
 *   1. Call History.push() before every user-initiated mutation.
 *   2. Call History.pop() to cancel a speculative push on rollback.
 *   3. Wire History.undo() / History.redo() to buttons and keyboard shortcuts.
 */
export const History = {

    // ── Snapshot helpers ─────────────────────────────────────────────────────

    /**
     * Captures a deep copy of all schedule-relevant state, including which
     * variant (if any) currently sits at the front of `State.combinations`
     * and the browsing offset from it. `frontComboIds` stores that variant
     * as its module IDs (not object references, and not the whole variant
     * list — see module doc above for why that single delta suffices).
     * wildcardRequests entries are shallow-copied; their `modules` arrays
     * reference the original data objects (immutable after init), but each
     * entry's own `seq` field is a plain number and copies naturally.
     * @returns {{ fixedSelection: Set<number>, fixedSeq: Map<number, number>,
     *             selectionCounter: number, wildcardRequests: Array,
     *             allowOverlap: boolean, allowFern: boolean, allowQuer: boolean,
     *             frontComboIds: number[]|null, comboIdx: number }}
     */
    _snapshot() {
        return {
            fixedSelection:     new Set(State.fixedSelection),
            fixedSeq:           new Map(State.fixedSeq),
            selectionCounter:   State.selectionCounter,
            wildcardRequests:   State.wildcardRequests.map(w => ({ ...w })),
            allowOverlap:       State.allowOverlap,
            allowFern:          State.allowFern,
            allowQuer:          State.allowQuer,
            frontComboIds:      State.combinations.length > 0
                ? State.combinations[0].map(m => m.id)
                : null,
            comboIdx:           State.comboIdx,
        };
    },

    /**
     * Writes a snapshot's selection/filter fields back to State and syncs the
     * filter-toggle checkboxes. Deliberately leaves `State.combinations` /
     * `State.comboIdx` alone — see `_restoreComboDisplay()` for why that has
     * to happen later.
     * Callers are responsible for calling Logic.updateSystem() and UI.renderAll()
     * afterwards.
     * @param {{ fixedSelection: Set<number>, fixedSeq: Map<number, number>,
     *           selectionCounter: number, wildcardRequests: Array,
     *           allowOverlap: boolean, allowFern: boolean, allowQuer: boolean }} snap
     */
    _restore(snap) {
        State.fixedSelection   = new Set(snap.fixedSelection);
        State.fixedSeq          = new Map(snap.fixedSeq);
        State.selectionCounter  = snap.selectionCounter;
        State.wildcardRequests = snap.wildcardRequests.map(w => ({ ...w }));
        State.allowOverlap     = snap.allowOverlap;
        State.allowFern        = snap.allowFern;
        State.allowQuer        = snap.allowQuer;

        // Keep checkbox DOM in sync with the restored filter state.
        const overlapChk = document.getElementById('allow-overlap-chk');
        const fernChk    = document.getElementById('allow-fern-chk');
        const querChk    = document.getElementById('allow-quer-chk');
        if (overlapChk) overlapChk.checked = snap.allowOverlap;
        if (fernChk)    fernChk.checked    = snap.allowFern;
        if (querChk)    querChk.checked    = snap.allowQuer;
    },

    /**
     * Re-applies a snapshot's front-of-list variant and browsing offset,
     * overwriting the `comboIdx` (and, if a variant needs pinning, the
     * ordering) that `Logic.updateSystem()` just recomputed. Must be called
     * *after* `Logic.updateSystem()`, since that recompute is what rebuilds
     * `State.combinations` in default order in the first place — this only
     * re-applies the front-pin delta and index on top of it.
     *
     * Reuses `Logic.bringMatchingComboToFront()` — the exact mechanism a
     * live mutation uses to pin a variant to index 0 — but targets it at
     * the snapshot's `frontComboIds` instead of whatever is currently
     * displayed. That distinction is what keeps this from behaving like a
     * live mutation: a live action pins "what's on screen right now"; this
     * pins "what was pinned back when the snapshot was taken", which is a
     * fixed, recorded fact rather than the live display. `comboIdx` is then
     * set independently, since front-pinning alone would always leave it
     * at 0 and lose any browsing offset the snapshot had.
     *
     * The snapshotted `frontComboIds` variant is guaranteed to exist in the
     * freshly recomputed list — both are a function of the same, just-
     * restored fixedSelection/wildcardRequests/filters, and this variant
     * was literally drawn from that list when the snapshot was taken. The
     * `idx === -1` branch is a defensive guard only, in case that invariant
     * is ever violated.
     * @param {{ frontComboIds?: number[]|null, comboIdx?: number }} snap
     */
    _restoreComboDisplay(snap) {
        if (State.combinations.length === 0) return;
        if (snap.frontComboIds) {
            Logic.bringMatchingComboToFront(snap.frontComboIds.map(id => State.moduleById[id]));
        }
        State.comboIdx = Math.min(Math.max(snap.comboIdx ?? 0, 0), State.combinations.length - 1);
    },

    // ── Stack management ─────────────────────────────────────────────────────

    /**
     * Saves the current state onto the undo stack and clears the redo stack.
     * Must be called before every user-initiated mutation that should be undoable.
     */
    push() {
        State.history.push(this._snapshot());
        if (State.history.length > CONFIG.MAX_UNDO_STEPS) {
            State.history.shift();
        }
        State.future = [];
        UI.updateHistoryButtons();
    },

    /**
     * Removes the most recent entry from the undo stack.
     * Used to cancel a speculative push when a tentative mutation is rolled back.
     */
    pop() {
        State.history.pop();
        UI.updateHistoryButtons();
    },

    // ── Public actions ───────────────────────────────────────────────────────

    /** Reverts to the previous schedule state (Ctrl+Z), incl. its displayed variant. */
    undo() {
        if (State.history.length === 0) return;
        State.future.push(this._snapshot());
        const snap = State.history.pop();
        this._restore(snap);
        Logic.updateSystem();
        this._restoreComboDisplay(snap);
        UI.renderAll();
        UI.updateHistoryButtons();
    },

    /** Re-applies the most recently undone state (Ctrl+Y / Ctrl+Shift+Z), incl. its displayed variant. */
    redo() {
        if (State.future.length === 0) return;
        State.history.push(this._snapshot());
        const snap = State.future.pop();
        this._restore(snap);
        Logic.updateSystem();
        this._restoreComboDisplay(snap);
        UI.renderAll();
        UI.updateHistoryButtons();
    },

    // ── Queries ───────────────────────────────────────────────────────────────

    canUndo() { return State.history.length > 0; },
    canRedo()  { return State.future.length  > 0; },

    /**
     * Returns the most recent undo-stack entry without removing it, or
     * `null` if the stack is empty.
     *
     * Used by the Actions layer to test whether an about-to-happen mutation
     * would exactly reverse the last recorded action — e.g. immediately
     * deselecting a module that was just selected. When it does, the action
     * performs a real `undo()` instead of a fresh push, which restores the
     * exact wildcard variant — and its exact position in the variant list —
     * that was displayed beforehand.
     * @returns {object|null}
     */
    top() {
        return State.history.length > 0 ? State.history[State.history.length - 1] : null;
    },

    /**
     * Structural equality check between two snapshots. `frontComboIds`,
     * `comboIdx`, `fixedSeq`, and `selectionCounter` are deliberately ignored
     * — they're display/ordering detail, not part of what makes two
     * schedule states "the same" for this comparison.
     * @param {{ fixedSelection: Set<number>, wildcardRequests: Array,
     *           allowOverlap: boolean, allowFern: boolean, allowQuer: boolean }|null} a
     * @param {{ fixedSelection: Set<number>, wildcardRequests: Array,
     *           allowOverlap: boolean, allowFern: boolean, allowQuer: boolean }|null} b
     * @returns {boolean}
     */
    snapshotsEqual(a, b) {
        if (!a || !b) return false;
        if (a.allowOverlap !== b.allowOverlap) return false;
        if (a.allowFern    !== b.allowFern)    return false;
        if (a.allowQuer    !== b.allowQuer)    return false;

        if (a.fixedSelection.size !== b.fixedSelection.size) return false;
        for (const id of a.fixedSelection) {
            if (!b.fixedSelection.has(id)) return false;
        }

        if (a.wildcardRequests.length !== b.wildcardRequests.length) return false;
        for (let i = 0; i < a.wildcardRequests.length; i++) {
            if (a.wildcardRequests[i].fach  !== b.wildcardRequests[i].fach)  return false;
            if (a.wildcardRequests[i].stufe !== b.wildcardRequests[i].stufe) return false;
        }
        return true;
    },
};
