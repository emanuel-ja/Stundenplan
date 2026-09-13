import { CONFIG } from './config.js';
import { State }  from './state.js';

// ─── Bit-manipulation helpers ────────────────────────────────────────────────

/**
 * Fast 32-bit population count using the parallel-prefix (Hamming weight) method.
 * Processes all bits in O(1) without loops or BigInt.
 * @param {number} n - Treated as an unsigned 32-bit integer.
 * @returns {number}
 */
function popcount32(n) {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Population count for a value split into two 32-bit halves.
 * Bitmasks can exceed 32 bits (5 days × 6 slots × 2 half-hour positions = 60 bits),
 * so we decompose once during preprocessing and use integer math everywhere else.
 * @param {number} lo - Lower 32 bits.
 * @param {number} hi - Upper 32 bits.
 * @returns {number}
 */
function popcountSplit(lo, hi) {
    return popcount32(lo) + popcount32(hi);
}

// ─── Bitmask computation helpers ─────────────────────────────────────────────

/**
 * Returns the grid-row (time-slot) index for a given "HH:MM" string.
 * Mirrors UI.getTimeIndex but is kept here so logic.js has no UI dependency.
 * @param {string} timeStr
 * @returns {number} Index into CONFIG.TIMES, or -1 if before the first slot.
 */
function getTimeIndex(timeStr) {
    for (let i = CONFIG.TIMES.length - 1; i >= 0; i--) {
        if (timeStr >= CONFIG.TIMES[i]) return i;
    }
    return -1;
}

/**
 * Returns true if a half-hour schedule entry occupies the *bottom* half of its slot.
 * Mirrors the logic in UI._resolvePosition without depending on UI.
 * @param {{ beginn: string, ist_halbe_stunde: boolean }} entry
 * @returns {boolean}
 */
function isBottomHalf(entry) {
    const [h, m] = entry.beginn.split(':').map(Number);
    const entryMinutes = h * 60 + m;
    const slotStart = CONFIG.TIMES[getTimeIndex(entry.beginn)];
    const [sh, sm] = slotStart.split(':').map(Number);
    return entryMinutes - (sh * 60 + sm) > 15;
}

// ─── Exported logic ──────────────────────────────────────────────────────────

export const Logic = {

    // ── Preprocessing ────────────────────────────────────────────────────────

    /**
     * Converts the raw JSON into indexed, annotated module objects.
     *
     * Each module receives:
     *   - A sequential integer `id` for O(1) matrix lookups.
     *   - `bitmaskLo` / `bitmaskHi`: the schedule bitmask split into 32-bit halves
     *     so the hot combinatorial loop never touches BigInt.
     *   - `popcount`: number of occupied time slots.
     *   - `isFern`, `isQuer`: classification flags read directly from the JSON.
     *
     * After all modules are processed, pairwise overlap counts and exception flags
     * are stored in flat typed arrays for cache-friendly access.
     */
    preprocessData() {
        let currentId = 0;

        const processModule = (m) => {
            if (m._processed) return;

            m.id = currentId++;

            // Compute the schedule bitmask from the module's schedule entries.
            // Layout: 5 days × 6 slots × 2 half-hour positions = 60 bits.
            // Bit index = day * 12 + timeIdx * 2 + half
            // entry.tag is 1-based (Mo=1 … Fr=5); subtract 1 for the 0-based bit layout.
            // A full-slot entry sets both half-bits; top/bottom half-entries set one each.
            let bitmask = 0n;
            for (const entry of m.schedule ?? []) {
                const timeIdx = getTimeIndex(entry.beginn);
                if (timeIdx < 0) continue;
                const base = BigInt((entry.tag - 1) * 12 + timeIdx * 2);
                if (!entry.ist_halbe_stunde) {
                    bitmask |= (3n << base);          // sets both bit+0 and bit+1
                } else if (isBottomHalf(entry)) {
                    bitmask |= (1n << (base + 1n));   // bottom half
                } else {
                    bitmask |= (1n << base);           // top half
                }
            }

            // Decompose BigInt bitmask into two 32-bit halves to avoid BigInt in the solver.
            m.bitmaskLo = Number(bitmask & 0xFFFF_FFFFn);
            m.bitmaskHi = Number((bitmask >> 32n) & 0xFFFF_FFFFn);
            m.popcount  = popcountSplit(m.bitmaskLo, m.bitmaskHi);

            // Classification flags are read directly from the JSON fields.
            m.isFern    = m.ist_fern === true;
            m.isQuer    = m.ist_quer === true;
            m._processed = true;

            State.moduleByName.set(m.name, m);
            State.moduleById.push(m);
            State.modules.push(m);
        };

        for (const fach of Object.values(State.data.Pflichtfach ?? {})) {
            for (const stufe of Object.values(fach)) stufe.forEach(processModule);
        }
        for (const modules of Object.values(State.data['Nicht-Pflichtfach'] ?? {})) {
            modules.forEach(processModule);
        }

        const N = State.totalModules = currentId;
        State.overlapMatrix   = new Uint8Array(N * N);
        State.exceptionMatrix = new Uint8Array(N * N);

        for (const [n1, n2] of CONFIG.COLLISION_EXCEPTIONS) {
            const m1 = State.moduleByName.get(n1);
            const m2 = State.moduleByName.get(n2);
            if (m1 && m2) {
                State.exceptionMatrix[m1.id * N + m2.id] = 1;
                State.exceptionMatrix[m2.id * N + m1.id] = 1;
            }
        }

        // Pre-compute all pairwise overlaps once so the solver can do O(1) lookups
        // instead of repeating bitwise AND operations on every candidate combination.
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const m1 = State.moduleById[i];
                const m2 = State.moduleById[j];
                const overlapLo = m1.bitmaskLo & m2.bitmaskLo;
                const overlapHi = m1.bitmaskHi & m2.bitmaskHi;
                if (overlapLo !== 0 || overlapHi !== 0) {
                    const count = popcountSplit(overlapLo, overlapHi);
                    State.overlapMatrix[m1.id * N + m2.id] = count;
                    State.overlapMatrix[m2.id * N + m1.id] = count;
                }
            }
        }

        Logic.extractClasses();
    },

    /**
     * Builds `State.classesMap` from the `klassen` annotations on each module.
     * Numeric class numbers become semester keys; 'Schnellspur' is a special category.
     */
    extractClasses() {
        State.classesMap = {};
        for (const m of State.modules) {
            if (!Array.isArray(m.klassen)) continue;
            for (const cls of m.klassen) {
                const numMatch = cls.match(/\d+/);
                const category = cls.toLowerCase().endsWith('m')
                    ? 'Schnellspur'
                    : numMatch ? parseInt(numMatch[0], 10) : null;
                if (category === null) continue;

                const bySem = (State.classesMap[category] ??= {});
                const list  = (bySem[cls] ??= []);
                if (!list.some(x => x.id === m.id)) list.push(m);
            }
        }
    },

    // ── Matrix accessors ─────────────────────────────────────────────────────

    /** @returns {boolean} True if the module pair is exempt from the overlap rule. */
    isEx(id1, id2) {
        return State.exceptionMatrix[id1 * State.totalModules + id2] === 1;
    },

    /** @returns {number} Number of shared time slots between two modules. */
    getOverlapCount(id1, id2) {
        return State.overlapMatrix[id1 * State.totalModules + id2];
    },

    // ── Constraint checks ────────────────────────────────────────────────────

    /**
     * Counts the non-exception overlaps within a module set.
     * Returns -1 immediately if any hard constraint is violated,
     * allowing callers to short-circuit without inspecting the full set.
     * @param {object[]} modules
     * @returns {number} Overlap count, or -1 on violation.
     */
    countInitialOverlaps(modules) {
        if (!State.allowFern && modules.some(m => m.isFern)) return -1;
        if (!State.allowQuer && modules.some(m => m.isQuer)) return -1;

        let count = 0;
        for (let i = 0; i < modules.length; i++) {
            for (let j = i + 1; j < modules.length; j++) {
                const m1 = modules[i], m2 = modules[j];
                const n = Logic.getOverlapCount(m1.id, m2.id);
                if (n > 0 && !Logic.isEx(m1.id, m2.id)) {
                    if (!State.allowOverlap)                                          return -1;
                    if (m1.isFern || m2.isFern)                                       return -1;
                    if (m1.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP
                     || m2.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP)                  return -1;
                    if (n > CONFIG.MAX_OVERLAP_SLOTS)                                 return -1;
                    count++;
                }
            }
        }
        return count;
    },

    /**
     * Tests whether module `m` can be added to an existing selection.
     * Checks all constraints against every module already in the set
     * and ensures the total overlap budget (max 1) is not exceeded.
     * @param {object}   m
     * @param {object[]} currentModules
     * @param {number}   currentUsedOverlaps
     * @returns {{ valid: boolean, newOvl?: number }}
     */
    canAddModule(m, currentModules, currentUsedOverlaps) {
        if (!State.allowFern && m.isFern) return { valid: false };
        if (!State.allowQuer && m.isQuer) return { valid: false };

        let newOvl = 0;
        for (const other of currentModules) {
            const n = Logic.getOverlapCount(m.id, other.id);
            if (n > 0 && !Logic.isEx(m.id, other.id)) {
                if (!State.allowOverlap)                                          return { valid: false };
                if (m.isFern || other.isFern)                                     return { valid: false };
                if (m.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP
                 || other.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP)               return { valid: false };
                if (n > CONFIG.MAX_OVERLAP_SLOTS)                                 return { valid: false };
                newOvl++;
            }
        }
        if (currentUsedOverlaps + newOvl > CONFIG.MAX_OVERLAP_PAIRS) return { valid: false };
        return { valid: true, newOvl };
    },

    /**
     * Computes the additional overlap introduced when appending `newModules`
     * to `baseModules`. Returns -1 if any constraint would be violated.
     * Used to validate wildcard combinations against the fixed selection.
     * @param {object[]} baseModules
     * @param {object[]} newModules
     * @param {number}   currentOvl - Overlap already consumed by baseModules.
     * @returns {number}
     */
    getInteractionOverlap(baseModules, newModules, currentOvl) {
        let additionalOvl = 0;
        for (const m of newModules) {
            for (const b of baseModules) {
                const n = Logic.getOverlapCount(m.id, b.id);
                if (n > 0 && !Logic.isEx(m.id, b.id)) {
                    if (!State.allowOverlap)                                          return -1;
                    if (m.isFern || b.isFern)                                         return -1;
                    if (m.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP
                     || b.popcount < CONFIG.MIN_SLOTS_FOR_OVERLAP)                   return -1;
                    if (n > CONFIG.MAX_OVERLAP_SLOTS)                                 return -1;
                    additionalOvl++;
                    if (currentOvl + additionalOvl > CONFIG.MAX_OVERLAP_PAIRS) return -1;
                }
            }
        }
        return additionalOvl;
    },

    // ── Combinatorial solver ─────────────────────────────────────────────────

    /**
     * Enumerates all valid wildcard combinations via depth-first backtracking.
     * Each wildcardRequest contributes exactly one module to a combination;
     * only module sets that satisfy all pairwise constraints are retained.
     *
     * Result is stored in `State.globalWildcardCombos` and reused by
     * `calculateCombinations()` and `isModuleViable()`.
     */
    updateGlobalWildcardCombos() {
        State.globalWildcardCombos = [];
        if (State.wildcardRequests.length === 0) return;

        const combo = [];

        function solve(depth, usedOvl) {
            if (depth === State.wildcardRequests.length) {
                State.globalWildcardCombos.push({ modules: [...combo], internalOvl: usedOvl });
                return;
            }
            for (const m of State.wildcardRequests[depth].modules) {
                const check = Logic.canAddModule(m, combo, usedOvl);
                if (check.valid) {
                    combo.push(m);
                    solve(depth + 1, usedOvl + check.newOvl);
                    combo.pop();
                }
            }
        }

        solve(0, 0);
    },

    /**
     * Interleaves a set of fixed modules and a set of wildcard-resolved
     * modules into the order the user actually selected them in, using
     * `State.fixedSeq` for the former and each `wildcardRequests[i].seq`
     * for the latter (matched by position — see `updateGlobalWildcardCombos()`,
     * where `wildcardModules[i]` is always the resolved pick for
     * `State.wildcardRequests[i]`).
     *
     * Without this, naively concatenating fixed modules before wildcard
     * modules (or vice versa) would always show one group ahead of the
     * other regardless of pick order — e.g. a wildcard chosen first would
     * still display after a fixed module chosen afterwards.
     * @param {object[]} fixedModules
     * @param {object[]} wildcardModules
     * @returns {object[]}
     */
    mergeBySelectionOrder(fixedModules, wildcardModules) {
        const tagged = [
            ...fixedModules.map(m => ({ m, seq: State.fixedSeq.get(m.id) ?? 0 })),
            ...wildcardModules.map((m, i) => ({ m, seq: State.wildcardRequests[i]?.seq ?? 0 })),
        ];
        tagged.sort((a, b) => a.seq - b.seq);
        return tagged.map(t => t.m);
    },

    /**
     * Filters `State.globalWildcardCombos` against the current fixed selection
     * and writes valid full schedules into `State.combinations`.
     * Capped at `CONFIG.MAX_COMBINATIONS` to keep the UI responsive.
     */
    calculateCombinations() {
        const fixedArray = Array.from(State.fixedSelection).map(id => State.moduleById[id]);
        // Exclude fixed modules that belong to a wildcard slot — they will be
        // substituted by the wildcard module in each combination.
        const baseSelection = fixedArray.filter(fs =>
            !State.wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
        );

        const initialOvl = Logic.countInitialOverlaps(baseSelection);
        if (initialOvl === -1) { State.combinations = []; return; }

        State.combinations = [];
        for (const wc of State.globalWildcardCombos) {
            if (initialOvl + wc.internalOvl > CONFIG.MAX_OVERLAP_PAIRS) continue;
            if (Logic.getInteractionOverlap(baseSelection, wc.modules, initialOvl + wc.internalOvl) !== -1) {
                State.combinations.push(Logic.mergeBySelectionOrder(baseSelection, wc.modules));
                if (State.combinations.length >= CONFIG.MAX_COMBINATIONS) break;
            }
        }
        State.comboIdx = 0;
    },

    /**
     * Recomputes wildcards and, if any are active, the full combination list.
     * Called after every state mutation via `dispatch()`.
     */
    updateSystem() {
        Logic.updateGlobalWildcardCombos();
        if (State.wildcardRequests.length > 0) {
            Logic.calculateCombinations();
        } else {
            State.combinations = [];
        }
    },

    // ── Wildcard display continuity ──────────────────────────────────────────

    /**
     * Returns the module set currently visible in the schedule grid — either
     * the active wildcard combination or the plain fixed selection.
     * Shared by `UI.renderAll()` and the Actions layer, which needs to know
     * what was on screen right before a mutation so the display can stay on
     * the same schedule (see `bringMatchingComboToFront()`).
     * @returns {object[]}
     */
    getDisplayedModules() {
        return State.combinations.length > 0
            ? State.combinations[State.comboIdx]
            : Array.from(State.fixedSelection).map(id => State.moduleById[id]);
    },

    /**
     * Finds the variant that best preserves continuity with what was on
     * screen before a wildcard-affecting mutation, and — if it isn't
     * already there — moves it to the front of `State.combinations` so it
     * displays as variant 1.
     *
     * Searches `State.combinations` (already recomputed by `updateSystem()`)
     * for the first variant that contains every module in `targetModules`.
     * If one exists anywhere but index 0, it is spliced out and unshifted
     * back in at index 0; every other variant keeps its relative order.
     * `State.comboIdx` is then (re)set to 0. Plain index-jumping would leave
     * the match at whatever position it already had — e.g. "4/12" — which
     * makes it easy to lose track of the lower-numbered variants while
     * paging onward from there; moving it to the front instead means the
     * user always continues browsing from "their" schedule at 1/12.
     *
     * If no matching variant exists (the change genuinely doesn't fit what
     * was shown before), nothing is reordered and the index is left at the
     * default of 0 set by `calculateCombinations()`.
     *
     * A no-op whenever no wildcards are active (`State.combinations` empty),
     * so callers can invoke it unconditionally after every mutation.
     * @param {object[]} targetModules - Modules that should remain visible.
     */
    bringMatchingComboToFront(targetModules) {
        if (State.combinations.length === 0) return;
        const targetIds = new Set(targetModules.map(m => m.id));
        const idx = State.combinations.findIndex(combo => {
            if (combo.length < targetIds.size) return false;
            const comboIds = new Set(combo.map(m => m.id));
            for (const id of targetIds) {
                if (!comboIds.has(id)) return false;
            }
            return true;
        });
        if (idx === -1) return;
        if (idx > 0) {
            const [match] = State.combinations.splice(idx, 1);
            State.combinations.unshift(match);
        }
        State.comboIdx = 0;
    },

    // ── Viability & conflict detection ───────────────────────────────────────

    /**
     * Tests whether there is at least one valid schedule that includes `mObj`.
     * Used to determine whether a sidebar item should be shown as greyed-out.
     *
     * If wildcards are active the check considers all pre-computed wildcard combos,
     * so the UI correctly reflects what is actually achievable.
     * @param {object}   mObj
     * @param {object[]} currentFixedArray
     * @returns {boolean}
     */
    isModuleViable(mObj, currentFixedArray) {
        // Selecting mObj replaces any existing module for the same Fach/Stufe.
        const testSelection = (mObj.fach_lang && mObj.stufe)
            ? currentFixedArray.filter(
                fs => !(fs.fach_lang === mObj.fach_lang && fs.stufe == mObj.stufe)
              )
            : currentFixedArray;

        const initialOvl = Logic.countInitialOverlaps(testSelection);
        if (initialOvl === -1) return false;

        if (State.wildcardRequests.length === 0) {
            return Logic.canAddModule(mObj, testSelection, initialOvl).valid;
        }

        // Does this module replace a wildcard slot?
        const cancelsWildcard = State.wildcardRequests.some(
            w => mObj.fach_lang && mObj.stufe && w.fach === mObj.fach_lang && w.stufe == mObj.stufe
        );

        if (cancelsWildcard) {
            // Only viable if it appears in at least one valid wildcard combo.
            return State.globalWildcardCombos.some(wc => {
                if (!wc.modules.some(x => x.id === mObj.id)) return false;
                if (initialOvl + wc.internalOvl > CONFIG.MAX_OVERLAP_PAIRS) return false;
                return Logic.getInteractionOverlap(testSelection, wc.modules, initialOvl + wc.internalOvl) !== -1;
            });
        }

        const check = Logic.canAddModule(mObj, testSelection, initialOvl);
        if (!check.valid) return false;

        const extended = [...testSelection, mObj];
        const extOvl   = initialOvl + check.newOvl;
        return State.globalWildcardCombos.some(wc => {
            if (extOvl + wc.internalOvl > CONFIG.MAX_OVERLAP_PAIRS) return false;
            return Logic.getInteractionOverlap(extended, wc.modules, extOvl + wc.internalOvl) !== -1;
        });
    },

    /**
     * Returns true if the current selection + wildcards remain feasible
     * under the current filter flags, without mutating state or re-rendering.
     * Called before committing a filter change that might invalidate the schedule.
     * @returns {boolean}
     */
    checkSystemValidWithCurrentSettings() {
        Logic.updateGlobalWildcardCombos();
        const fixedArray = Array.from(State.fixedSelection).map(id => State.moduleById[id]);
        const baseSelection = fixedArray.filter(fs =>
            !State.wildcardRequests.some(w => w.fach === fs.fach_lang && w.stufe == fs.stufe)
        );
        const initialOvl = Logic.countInitialOverlaps(baseSelection);
        if (initialOvl === -1) return false;
        if (State.wildcardRequests.length === 0) return true;

        return State.globalWildcardCombos.some(wc => {
            if (initialOvl + wc.internalOvl > CONFIG.MAX_OVERLAP_PAIRS) return false;
            return Logic.getInteractionOverlap(baseSelection, wc.modules, initialOvl + wc.internalOvl) !== -1;
        });
    },

    /**
     * Groups the modules of a class by their time conflicts using BFS.
     * Conflict groups with ≥2 members are returned so the user can resolve them.
     * @param {object[]} modules
     * @returns {object[][]}
     */
    getConflictGroupsForClass(modules) {
        const adjList = new Map(modules.map(m => [m.id, []]));

        for (let i = 0; i < modules.length; i++) {
            for (let j = i + 1; j < modules.length; j++) {
                const m1 = modules[i], m2 = modules[j];
                if (Logic.getOverlapCount(m1.id, m2.id) > 0 && !Logic.isEx(m1.id, m2.id)) {
                    adjList.get(m1.id).push(m2);
                    adjList.get(m2.id).push(m1);
                }
            }
        }

        const visited = new Set();
        const groups  = [];

        for (const m of modules) {
            if (visited.has(m.id)) continue;
            const group = [];
            const queue = [m];
            visited.add(m.id);

            while (queue.length > 0) {
                const curr = queue.shift();
                group.push(curr);
                for (const neighbor of adjList.get(curr.id)) {
                    if (!visited.has(neighbor.id)) {
                        visited.add(neighbor.id);
                        queue.push(neighbor);
                    }
                }
            }
            if (group.length > 1) groups.push(group);
        }
        return groups;
    },

    /**
     * Groups the modules of a class by identical Pflichtfach + Stufe.
     *
     * Only Pflichtfach modules carry `fach_lang`/`stufe`, so Nicht-Pflichtfach
     * modules are skipped — grouping is meaningless for them. Groups with
     * ≥2 members represent multiple modules of the same subject and level,
     * of which a class schedule may only contain one, regardless of whether
     * they actually collide on the grid (see `getConflictGroupsForClass`).
     *
     * This is independent of time-conflict grouping: callers are expected to
     * run this on the module set that remains *after* overlap conflicts have
     * already been resolved, so a group whose members were already narrowed
     * down to one via the overlap modal naturally no longer appears here.
     * @param {object[]} modules
     * @returns {object[][]}
     */
    getFachStufeGroupsForClass(modules) {
        const byFachStufe = new Map();

        for (const m of modules) {
            if (!m.fach_lang || !m.stufe) continue;
            const key = `${m.fach_lang}\u0000${m.stufe}`;
            const group = byFachStufe.get(key) ?? byFachStufe.set(key, []).get(key);
            group.push(m);
        }

        return [...byFachStufe.values()].filter(group => group.length > 1);
    },
};
