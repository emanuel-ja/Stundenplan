/**
 * Application-wide constants.
 * Frozen at runtime to prevent accidental mutation.
 */
export const CONFIG = Object.freeze({
    /** Slot start times in "HH:MM" format, Monday–Friday, 17:10–21:10. */
    TIMES: ["17:10", "17:55", "18:45", "19:30", "20:25", "21:10"],

    /**
     * Module name pairs that are permitted to share the same time slot.
     */
    COLLISION_EXCEPTIONS: [
        ["M2m",   "M3m"],   ["M4m",  "M5m"],  ["M6m",  "M7m"],
        ["D2m",   "D3m"],   ["D4m",  "D5m"],  ["D6m",  "D7m"],
        ["E2m",   "E3m"],   ["E4m",  "E5m"],  ["E6m",  "E7m"],
        ["CH1k",  "CH2k"],  ["GPB2k", "GPB3k"],
        ["CH1g",  "CH2g"],  ["GPB2g", "GPB3g"],
    ],

    /**
    * allowOverlap section ------------------------------------------------------
    */
    /** Minimum number of time slots a module needs to be eligible for overlap. */
    MIN_SLOTS_FOR_OVERLAP: 6,

    /** Maximum number of overlapping slots tolerated between two modules. */
    MAX_OVERLAP_SLOTS: 2,

    /** Maximum number of overlapping module *pairs* permitted in one schedule. */
    MAX_OVERLAP_PAIRS: 1,
    /**
     * ---------------------------------------------------------------------------
     */

    /** Combinatorial search stops once this many valid combinations are found. */
    MAX_COMBINATIONS: 10_000,
    
     /** Maximum number of undo steps */
    MAX_UNDO_STEPS: 100,

    /**
     * Long names (fach_lang / Pflichtfach key) of subjects that must never
     * receive a "–beliebig" wildcard entry in the sidebar.
     */
    NO_WILDCARD_FAECHER: ['Religion'],
    
});