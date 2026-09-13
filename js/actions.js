import { CONFIG }   from './config.js';
import { State }   from './state.js';
import { Logic }   from './logic.js';
import { UI }      from './ui.js';
import { Modals }  from './modals.js';
import { History } from './history.js';

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Applies a state mutation, then recalculates system state and re-renders.
 * Every user interaction that changes state must go through this function
 * so the combinatorial solver and the UI stay in sync.
 * @param {() => void}       mutation    - Pure function that mutates State fields.
 * @param {(() => void)|null} [afterUpdate] - Optional hook run after
 *        Logic.updateSystem() but before UI.renderAll() — used by wildcard
 *        add/remove actions to bring the matching variant to the front of
 *        `State.combinations` once it has been (re)computed (see
 *        `Logic.bringMatchingComboToFront()`).
 */
export function dispatch(mutation, afterUpdate) {
    mutation();
    Logic.updateSystem();
    if (afterUpdate) afterUpdate();
    UI.renderAll();
}

// ─── Wildcard continuity helpers ───────────────────────────────────────────────

/**
 * Returns `modules` with any entry occupying the same Fach/Stufe slot as
 * `newModule` removed, plus `newModule` itself appended.
 * Used to build the "target" module set that `Logic.bringMatchingComboToFront()`
 * should look for after pinning a module into a slot — i.e. what was on
 * screen before, minus whatever occupied that one slot, plus the new pick.
 * @param {object[]} modules
 * @param {object}   newModule
 * @returns {object[]}
 */
function replaceSlotInModules(modules, newModule) {
    const rest = modules.filter(
        m => !(m.fach_lang === newModule.fach_lang && m.stufe == newModule.stufe)
    );
    return [...rest, newModule];
}

// ─── Selection-order bookkeeping ────────────────────────────────────────────────
//
// Fixed picks and wildcard activations live in two separate structures
// (`State.fixedSelection`, `State.wildcardRequests`) that are each correctly
// ordered on their own, but carry no shared timeline — so combining them
// (e.g. for chip display, see `Logic.mergeBySelectionOrder()`) needs a
// common clock. These helpers are the only places that advance it; call
// sites below use them instead of touching `State.fixedSelection` /
// `State.wildcardRequests` directly whenever a selection genuinely changes.

/**
 * Pins a module as a *fresh* pick, stamping it with the current selection
 * order. Idempotent-ish like `Set.add()`, but always re-stamps — swapping
 * the module in an already-occupied slot is treated as a new pick, moving
 * its chip to the end, consistent with plain re-selection.
 * @param {number} id
 */
function selectFixedModule(id) {
    State.fixedSelection.add(id);
    State.fixedSeq.set(id, ++State.selectionCounter);
}

/**
 * Permanently unpins a module and forgets its selection-order stamp, so a
 * later re-pick of the same module starts fresh rather than reusing a stale
 * position. Not used for the tentative remove/restore round-trip in
 * `toggleWildcard()`'s rollback path, which deliberately bypasses this to
 * preserve the original stamps if the tentative change is undone.
 * @param {number} id
 */
function deselectFixedModule(id) {
    State.fixedSelection.delete(id);
    State.fixedSeq.delete(id);
}

/**
 * Activates a wildcard slot, stamping it with the current selection order.
 * @param {{fach: string, stufe: string, modules: object[]}} entry
 */
function activateWildcard(entry) {
    entry.seq = ++State.selectionCounter;
    State.wildcardRequests.push(entry);
}

/**
 * Clears every selection (fixed and wildcard) and resets the shared
 * selection-order clock. Safe only because both structures are always
 * cleared together at every call site — a partial reset would leave stale
 * `fixedSeq`/`wildcardRequests[i].seq` values that predate the clock restart.
 */
function resetSelections() {
    State.fixedSelection.clear();
    State.fixedSeq.clear();
    State.wildcardRequests = [];
    State.selectionCounter = 0;
}

/**
 * Builds a full prospective snapshot for `undoInsteadOfPushIfReverses()` /
 * `History.snapshotsEqual()`, starting from the current State and applying
 * the given overrides. Keeps every call site free of having to spell out
 * the fields it isn't changing.
 * @param {object} overrides - Any subset of { fixedSelection, wildcardRequests,
 *        allowOverlap, allowFern, allowQuer }.
 * @returns {{ fixedSelection: Set<number>, wildcardRequests: Array,
 *             allowOverlap: boolean, allowFern: boolean, allowQuer: boolean }}
 */
function prospectiveSnapshot(overrides) {
    return {
        fixedSelection:   State.fixedSelection,
        wildcardRequests: State.wildcardRequests,
        allowOverlap:     State.allowOverlap,
        allowFern:        State.allowFern,
        allowQuer:        State.allowQuer,
        ...overrides,
    };
}

/**
 * If undoing the most recent history entry would land on exactly the state
 * `prospective` describes, performs that Undo instead of a fresh
 * History.push() and reports back that it did so.
 *
 * This is how "select a module, then immediately deselect it again" (or the
 * wildcard/filter-toggle equivalent, e.g. unchecking "Überschneidung
 * zulassen" and immediately re-checking it) recovers the exact schedule
 * variant that was on screen beforehand — including its position in the
 * variant list — rather than only the best-effort match
 * `Logic.bringMatchingComboToFront()` can offer.
 * It correctly declines whenever the action wouldn't be a *perfect*
 * reversal (e.g. picking a module also silently cancelled a wildcard for
 * its slot, which plain deselection does not restore).
 * @param {{ fixedSelection: Set<number>, wildcardRequests: Array,
 *           allowOverlap: boolean, allowFern: boolean, allowQuer: boolean }} prospective
 *        The full state the action is about to produce — build with `prospectiveSnapshot()`.
 * @returns {boolean} true if History.undo() was performed; caller should stop.
 */
function undoInsteadOfPushIfReverses(prospective) {
    const top = History.top();
    if (!top) return false;
    if (!History.snapshotsEqual(prospective, top)) return false;
    History.undo();
    return true;
}

// ─── Impressum content ───────────────────────────────────────────────────────

/**
 * Static Impressum content, one entry per section. Kept as data (rather than
 * inline markup) so `buildImpressumBody()` can stay a plain DOM builder, in
 * line with the rest of this codebase's avoidance of innerHTML.
 * @type {Array<{heading: string, lines: string[]}>}
 */
const IMPRESSUM_SECTIONS = [
    {
        heading: 'Medieninhaber und Herausgeber',
        lines: ['Bundesgymnasium, Bundesrealgymnasium und wirtschaftskundliches Bundesrealgymnasium für Berufstätige', '', 'Adolf-Pichler-Platz 1', '6020 Innsbruck', 'Österreich'],
    },
    {
        heading: 'Kontakt',
        lines: ['E-Mail: abendgym@tsn.at', 'Telefon: +43 512 584488', 'Website: http://www.abendgym.tsn.at'],
    },
    {
        heading: 'Haftung für Inhalte',
        lines: [
            'Die Inhalte dieser Website, insbesondere die dargestellten Module, Zeiten und ' +
            'Stundenpläne, wurden mit großer Sorgfalt zusammengestellt. Für ihre ' +
            'Richtigkeit, Vollständigkeit und Aktualität wird jedoch keine Gewähr übernommen.',
        ],
    },
    /*{
        heading: 'Haftung für Links',
        lines: [
            'Diese Website enthält keine Links zu externen Websites Dritter. Sollten künftig ' +
            'solche Links eingefügt werden, wird auf deren Inhalte kein Einfluss genommen. ' +
            'Dafür ist ausschließlich der jeweilige Anbieter bzw. Betreiber verantwortlich.',
        ],
    },*/
    {
        heading: 'Urheberrecht',
        lines: ['Alle Inhalte dieser Webseite unterliegen dem Urheberrecht.'],
    },
        {
        heading: 'Transparenz zur Erstellung der Website',
        lines: ['Bei der Erstellung dieser Website wurden die KI-Sprachmodelle Claude, Gemini und ChatGPT als unterstützende Werkzeuge eingesetzt.'],
    },
];

/**
 * Builds the scrollable body element for the Impressum modal from
 * `IMPRESSUM_SECTIONS` — one heading + paragraph per section, styled via the
 * `.legal-section` rules (see style.css, Modals section).
 * @returns {HTMLElement}
 */
function buildImpressumBody() {
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-body-scrollable text-left';

    for (const { heading, lines } of IMPRESSUM_SECTIONS) {
        const section = document.createElement('section');
        section.className = 'legal-section';

        const h2 = document.createElement('h2');
        h2.textContent = heading;
        section.appendChild(h2);

        const p = document.createElement('p');
        lines.forEach((line, i) => {
            if (i > 0) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
        });
        section.appendChild(p);

        wrapper.appendChild(section);
    }

    return wrapper;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export const Actions = {

    /**
     * Pins or unpins a specific module.
     * Pinning a module auto-clears any wildcard request for the same Fach/Stufe,
     * and deselects any previously pinned module for the same slot.
     * @param {object}      m
     * @param {string|null} fach
     * @param {string|null} stufe
     */
    toggleFixedModule(m, fach, stufe) {
        const isDeselecting = State.fixedSelection.has(m.id);

        if (isDeselecting) {
            // Plain deselection only ever touches fixedSelection, so if that
            // matches the last history entry exactly, this action is a pure
            // reversal — let History.undo() handle it (see helper doc).
            const prospectiveFixed = new Set(State.fixedSelection);
            prospectiveFixed.delete(m.id);
            const reversed = undoInsteadOfPushIfReverses(
                prospectiveSnapshot({ fixedSelection: prospectiveFixed })
            );
            if (reversed) return;
        }

        // Capture what's on screen now so the display can jump back to "the
        // same schedule" (± this module) once the mutation is applied.
        const displayedBefore = Logic.getDisplayedModules();

        History.push();
        dispatch(() => {
            if (isDeselecting) {
                deselectFixedModule(m.id);
                return;
            }

            // When explicitly picking a module, cancel the open wildcard for its slot.
            if (fach && stufe) {
                const wIdx = State.wildcardRequests.findIndex(w => w.fach === fach && w.stufe === stufe);
                if (wIdx > -1) State.wildcardRequests.splice(wIdx, 1);

                // Remove any other fixed module occupying the same Fach/Stufe slot.
                for (const id of [...State.fixedSelection]) {
                    const fs = State.moduleById[id];
                    if (fs?.fach_lang === m.fach_lang && fs.stufe == m.stufe) {
                        deselectFixedModule(id);
                    }
                }
            }

            const currentArray = Array.from(State.fixedSelection).map(id => State.moduleById[id]);
            const ovl = Logic.countInitialOverlaps(currentArray);
            if (ovl !== -1 && Logic.canAddModule(m, currentArray, ovl).valid) {
                selectFixedModule(m.id);
            }
        }, () => {
            const target = isDeselecting
                ? displayedBefore.filter(mod => mod.id !== m.id)
                : replaceSlotInModules(displayedBefore, m);
            Logic.bringMatchingComboToFront(target);
        });
    },

    /**
     * Removes a module from the schedule.
     * If the module is pinned, it is unpinned.
     * If it is currently displayed as part of a wildcard combination,
     * the wildcard request itself is removed instead.
     * @param {object} m
     */
    removeModule(m) {
        const isFixed = State.fixedSelection.has(m.id);

        const prospectiveFixed = new Set(State.fixedSelection);
        let prospectiveWildcards = State.wildcardRequests;
        if (isFixed) {
            prospectiveFixed.delete(m.id);
        } else {
            prospectiveWildcards = State.wildcardRequests.filter(
                w => !(w.fach === m.fach_lang && w.stufe == m.stufe)
            );
        }
        const reversed = undoInsteadOfPushIfReverses(
            prospectiveSnapshot({ fixedSelection: prospectiveFixed, wildcardRequests: prospectiveWildcards })
        );
        if (reversed) return;

        const displayedBefore = Logic.getDisplayedModules();

        History.push();
        dispatch(() => {
            if (State.fixedSelection.has(m.id)) {
                deselectFixedModule(m.id);
                return;
            }
            // Module came from a wildcard combo — remove the wildcard request.
            const wIdx = State.wildcardRequests.findIndex(
                w => w.fach === m.fach_lang && w.stufe == m.stufe
            );
            if (wIdx > -1) State.wildcardRequests.splice(wIdx, 1);
        }, () => {
            Logic.bringMatchingComboToFront(displayedBefore.filter(mod => mod.id !== m.id));
        });
    },

    /**
     * Toggles the wildcard ("beliebig") entry for a Fach/Stufe slot.
     * Activating it clears any pinned module for that slot.
     * If adding the wildcard would push the valid-variant count past
     * MAX_COMBINATIONS, the addition is rolled back and the user is notified.
     * @param {string}   fach
     * @param {string}   stufe
     * @param {object[]} modules - All candidates for this slot.
     */
    toggleWildcard(fach, stufe, modules) {
        const idx = State.wildcardRequests.findIndex(w => w.fach === fach && w.stufe === stufe);

        if (idx > -1) {
            // Removing a wildcard is always safe — just dispatch.
            const reversed = undoInsteadOfPushIfReverses(
                prospectiveSnapshot({ wildcardRequests: State.wildcardRequests.filter((_, i) => i !== idx) })
            );
            if (reversed) return;

            const displayedBefore = Logic.getDisplayedModules();
            History.push();
            dispatch(() => {
                State.wildcardRequests.splice(idx, 1);
            }, () => {
                Logic.bringMatchingComboToFront(
                    displayedBefore.filter(mod => !(mod.fach_lang === fach && mod.stufe == stufe))
                );
            });
            return;
        }

        // Adding a wildcard: save any pinned IDs for this slot so they can be
        // restored if the addition has to be rolled back.
        const savedIds = modules.reduce((acc, m) => {
            if (State.fixedSelection.has(m.id)) acc.push(m.id);
            return acc;
        }, []);

        const prospectiveFixed = new Set(State.fixedSelection);
        savedIds.forEach(id => prospectiveFixed.delete(id));
        const reversed = undoInsteadOfPushIfReverses(
            prospectiveSnapshot({
                fixedSelection:   prospectiveFixed,
                wildcardRequests: [...State.wildcardRequests, { fach, stufe, modules }],
            })
        );
        if (reversed) return;

        const displayedBefore = Logic.getDisplayedModules();

        // Snapshot before any tentative mutation so rollback can cancel it.
        History.push();

        // Apply tentatively, then check the combination count.
        savedIds.forEach(id => State.fixedSelection.delete(id));
        activateWildcard({ fach, stufe, modules });
        Logic.updateSystem();

        if (State.combinations.length >= CONFIG.MAX_COMBINATIONS) {
            // Roll back before showing the modal so that both "OK" and
            // backdrop-click leave the schedule in its previous valid state.
            const rollbackIdx = State.wildcardRequests.findIndex(w => w.fach === fach && w.stufe === stufe);
            if (rollbackIdx > -1) State.wildcardRequests.splice(rollbackIdx, 1);
            savedIds.forEach(id => State.fixedSelection.add(id));
            Logic.updateSystem();
            UI.renderAll();
            // Cancel the speculative history entry — nothing actually changed.
            History.pop();
            Modals.showAlert(
                `Die Anzahl der gültigen Stundenplan-Varianten überschreitet ${CONFIG.MAX_COMBINATIONS}. ` +
                `Bitte wähle konkrete Module statt der Option \u2013beliebig.`
            );
            return;
        }

        // Keep showing "the same schedule" (plus whatever this wildcard now
        // resolves to) instead of resetting to the first combination.
        Logic.bringMatchingComboToFront(displayedBefore);
        UI.renderAll();
    },

    /** Converts the currently displayed combination into a permanent fixed selection. */
    applyCurrentCombo() {
        History.push();
        dispatch(() => {
            // Already in correct "as chosen" order post-merge — re-stamping in
            // this order via selectFixedModule() carries that order forward
            // into the now wildcard-free fixed selection.
            const modulesToKeep = State.combinations[State.comboIdx];
            resetSelections();
            modulesToKeep.forEach(m => selectFixedModule(m.id));
        });
    },

    nextCombo() {
        if (State.combinations.length === 0) return;
        State.comboIdx = (State.comboIdx + 1) % State.combinations.length;
        UI.renderAll();
    },

    prevCombo() {
        if (State.combinations.length === 0) return;
        State.comboIdx = (State.comboIdx - 1 + State.combinations.length) % State.combinations.length;
        UI.renderAll();
    },

    /**
     * Clears all selections and collapses the sidebar.
     * @param {boolean} [skipConfirm]   Skip the confirmation dialog (e.g. called from a toggle callback).
     * @param {boolean} [skipHistory]   Skip History.push() when the calling action has already
     *                                  pushed a snapshot that should serve as the undo target.
     *                                  This prevents a double-entry on the undo stack when a
     *                                  filter toggle triggers a forced reset.
     */
    resetSchedule(skipConfirm = false, skipHistory = false) {
        const doReset = () => {
            if (!skipHistory) History.push();
            dispatch(resetSelections);
            UI.collapseAllAccordions();
        };

        if (skipConfirm) { doReset(); return; }
        Modals.showConfirm('Soll der Stundenplan komplett zurückgesetzt werden?', doReset, undefined, 'Ja, zurücksetzen');
    },

    // ── Filter toggles ────────────────────────────────────────────────────────

    /**
     * All three filter toggles share the same pattern:
     * 1. If the new state matches what undoing the last history entry would
     *    produce (e.g. the user just flipped this same toggle back), perform
     *    that Undo instead of a fresh push — see `undoInsteadOfPushIfReverses()`.
     * 2. If the checkbox moves to a less restrictive state → always safe, just apply.
     * 3. If it moves to a more restrictive state → tentatively apply, validate,
     *    and offer to reset or revert if the current selection becomes infeasible.
     *
     * In branches 2 and 3, History.push() is called before any mutation so that
     * undo/redo always covers the filter flag together with the schedule state.
     * For the "revert" path (user cancels the restriction) History.pop() discards
     * the speculative entry because no observable state change occurred.
     *
     * Whenever wildcards are active, `Logic.bringMatchingComboToFront()` moves the
     * schedule variant that matches what was on screen before (± whatever the
     * flag change forces) to the front, so the display continues at "1/N"
     * instead of resetting to an unrelated first combination or stranding
     * the user mid-list.
     *
     * The three functions below follow this pattern for their specific flag.
     */

    toggleAllowOverlap() {
        const chk = document.getElementById('allow-overlap-chk');
        const newValue = chk.checked;

        const reversed = undoInsteadOfPushIfReverses(prospectiveSnapshot({ allowOverlap: newValue }));
        if (reversed) return;

        const displayedBefore = Logic.getDisplayedModules();

        if (newValue) {
            History.push();
            dispatch(() => { State.allowOverlap = true; }, () => {
                Logic.bringMatchingComboToFront(displayedBefore);
            });
            return;
        }
        // Snapshot before the tentative direct mutation so the undo entry
        // captures the pre-change state (allowOverlap = true).
        History.push();
        State.allowOverlap = false;
        if (Logic.checkSystemValidWithCurrentSettings()) {
            dispatch(() => { State.allowOverlap = false; }, () => {
                Logic.bringMatchingComboToFront(displayedBefore);
            });
        } else {
            Modals.showConfirm(
                'Für die aktuelle Modulwahl ist eine Überschneidung erforderlich. Soll der Stundenplan komplett zurückgesetzt werden?',
                () => { chk.checked = false; State.allowOverlap = false; Actions.resetSchedule(true, true); },
                () => {
                    History.pop();
                    chk.checked = true;
                    dispatch(() => { State.allowOverlap = true; }, () => {
                        Logic.bringMatchingComboToFront(displayedBefore);
                    });
                },
                'Ja, zurücksetzen'
            );
        }
    },

    toggleAllowFern() {
        const chk = document.getElementById('allow-fern-chk');
        const newValue = chk.checked;

        const reversed = undoInsteadOfPushIfReverses(prospectiveSnapshot({ allowFern: newValue }));
        if (reversed) return;

        const displayedBefore = Logic.getDisplayedModules();

        if (!newValue) {
            // Unchecked → Fernstudium disabled: more restrictions → validate
            History.push();
            State.allowFern = false;
            if (Logic.checkSystemValidWithCurrentSettings()) {
                dispatch(() => { State.allowFern = false; }, () => {
                    Logic.bringMatchingComboToFront(displayedBefore);
                });
            } else {
                Modals.showConfirm(
                    'Für die aktuelle Modulwahl sind Fernstudienmodule erforderlich. Soll der Stundenplan komplett zurückgesetzt werden?',
                    () => { chk.checked = false; State.allowFern = false; Actions.resetSchedule(true, true); },
                    () => {
                        History.pop();
                        chk.checked = true;
                        dispatch(() => { State.allowFern = true; }, () => {
                            Logic.bringMatchingComboToFront(displayedBefore);
                        });
                    },
                    'Ja, zurücksetzen'
                );
            }
            return;
        }
        // Checked → Fernstudium active: always secure
        History.push();
        dispatch(() => { State.allowFern = true; }, () => {
            Logic.bringMatchingComboToFront(displayedBefore);
        });
    },

    toggleAllowQuer() {
        const chk = document.getElementById('allow-quer-chk');
        const newValue = chk.checked;

        const reversed = undoInsteadOfPushIfReverses(prospectiveSnapshot({ allowQuer: newValue }));
        if (reversed) return;

        const displayedBefore = Logic.getDisplayedModules();

        if (!newValue) {
            // Unchecked → Quereinsteiger disabled: more restrictions → validate
            History.push();
            State.allowQuer = false;
            if (Logic.checkSystemValidWithCurrentSettings()) {
                dispatch(() => { State.allowQuer = false; }, () => {
                    Logic.bringMatchingComboToFront(displayedBefore);
                });
            } else {
                Modals.showConfirm(
                    'Für die aktuelle Modulwahl sind Quereinsteigermodule erforderlich. Soll der Stundenplan komplett zurückgesetzt werden?',
                    () => { chk.checked = false; State.allowQuer = false; Actions.resetSchedule(true, true); },
                    () => {
                        History.pop();
                        chk.checked = true;
                        dispatch(() => { State.allowQuer = true; }, () => {
                            Logic.bringMatchingComboToFront(displayedBefore);
                        });
                    },
                    'Ja, zurücksetzen'
                );
            }
            return;
        }
        // Checked → Quereinsteiger active: always secure
        History.push();
        dispatch(() => { State.allowQuer = true; }, () => {
            Logic.bringMatchingComboToFront(displayedBefore);
        });
    },

    // ── Class schedule ────────────────────────────────────────────────────────

    /**
     * Loads a class schedule, resolving Fernstudium/Quereinsteiger warnings,
     * time-conflict groups, and same-Fach/Stufe duplicates via sequential
     * modal dialogs.
     * @param {string}        className
     * @param {string|number} semester
     */
    async applyClassSchedule(className, semester) {
        const classModules = State.classesMap[semester][className];

        // ── Phase 1: Collect all user decisions via modals WITHOUT mutating state.
        //    History.push() must be called before the first state mutation so that
        //    the snapshot captures the true pre-change values of allowFern/allowQuer.
        //    Previously these flags were mutated here (before History.push()), which
        //    caused undo to restore the already-changed toggle state instead of the
        //    original one.

        let enableFern = false;
        if (classModules.some(m => m.isFern) && !document.getElementById('allow-fern-chk').checked) {
            const allow = await Modals.confirm(
                `In der Klasse ${className} sind auch Fernstudienmodule. Dürfen Fernstudienmodule aktiviert werden?`
            );
            if (!allow) return;
            enableFern = true;
        }

        let enableQuer = false;
        if (classModules.some(m => m.isQuer) && !document.getElementById('allow-quer-chk').checked) {
            const allow = await Modals.confirm(
                `In der Klasse ${className} sind auch Quereinsteigermodule. Dürfen Quereinsteigermodule aktiviert werden?`
            );
            if (!allow) return;
            enableQuer = true;
        }

        const conflictGroups = Logic.getConflictGroupsForClass(classModules);
        const resolvedConflicts = [];

        for (const group of conflictGroups) {
            const choice = await Modals.chooseModule(group);
            if (!choice) return;
            resolvedConflicts.push(choice);
        }

        const conflictedNames = new Set(conflictGroups.flat().map(m => m.name));
        const nonConflicting  = classModules.filter(m => !conflictedNames.has(m.name));

        // Modules of the same Pflichtfach + Stufe must also be narrowed down
        // to one, even when they don't collide on the grid (e.g. M1s/M1t).
        // Running this on the post-overlap-resolution set means a group
        // already decided above — because the overlap made all its members
        // occur together in a conflict modal — no longer shows up here, so
        // the user is never asked twice about the same modules.
        let finalSelection = [...nonConflicting, ...resolvedConflicts];

        for (const group of Logic.getFachStufeGroupsForClass(finalSelection)) {
            const choice = await Modals.chooseModule(group);
            if (!choice) return;
            const groupNames = new Set(group.map(m => m.name));
            finalSelection = finalSelection.filter(m => !groupNames.has(m.name));
            finalSelection.push(choice);
        }

        // ── Phase 2: All decisions confirmed — snapshot the pre-change state,
        //    then apply all mutations atomically.

        History.push();

        if (enableFern) {
            document.getElementById('allow-fern-chk').checked = true;
            State.allowFern = true;
        }
        if (enableQuer) {
            document.getElementById('allow-quer-chk').checked = true;
            State.allowQuer = true;
        }

        dispatch(() => {
            resetSelections();
            finalSelection.forEach(m => selectFixedModule(m.id));
        });

        UI.collapseAllAccordions();
        Actions.switchMobileView('schedule');
    },

    // ── PDF export ────────────────────────────────────────────────────────────

    exportPDF() {
        const list = document.getElementById('print-modules');
        list.textContent = '';

        const modules = Logic.getDisplayedModules();

        [...modules]
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(m => {
                const li = document.createElement('li');
                const strong = document.createElement('strong');
                strong.textContent = m.name;
                li.appendChild(strong);
                li.appendChild(document.createTextNode(` (${m.lehrer})`));
                list.appendChild(li);
            });

        setTimeout(() => window.print(), 100);
    },

    // ── Impressum ────────────────────────────────────────────────────────────

    /** Opens the Impressum content in the shared modal (see modals.js). */
    showImpressum() {
        Modals.show({
            title: 'Impressum',
            bodyElement: buildImpressumBody(),
            widthClass: 'modal-wide',
            buttons: [
                { text: 'OK', className: 'btn btn-primary btn-md w-full' },
            ],
        });
    },

    // ── Mobile view ───────────────────────────────────────────────────────────

    /** @param {'schedule'|'sidebar'} view */
    switchMobileView(view) {
        if (State.mobileView === view) return;
        // Persist scroll position before leaving the sidebar.
        if (State.mobileView === 'sidebar') {
            const acc = document.getElementById('accordion-container');
            if (acc) State.sidebarScrollPos = acc.scrollTop;
        }
        State.mobileView = view;
        UI.updateMobileView();
    },
};
