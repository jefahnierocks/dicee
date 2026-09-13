/* tslint:disable */
/* eslint-disable */

/**
 * Analyze the current turn and return optimal strategy.
 *
 * This is the primary solver interface providing:
 * - Optimal action recommendation (score vs reroll)
 * - Keep pattern for rerolling (which dice to keep)
 * - Expected values for all available categories
 *
 * # Arguments
 *
 * * `dice` - Array of 5 dice values (1-6)
 * * `rolls_remaining` - Number of rerolls left (0, 1, or 2)
 * * `available_categories` - Bitmask of available categories (0x1FFF = all 13)
 *
 * # Bitmask Convention
 *
 * ```text
 * Bit 0:  Ones           (0x0001)
 * Bit 1:  Twos           (0x0002)
 * Bit 2:  Threes         (0x0004)
 * Bit 3:  Fours          (0x0008)
 * Bit 4:  Fives          (0x0010)
 * Bit 5:  Sixes          (0x0020)
 * Bit 6:  ThreeOfAKind   (0x0040)
 * Bit 7:  FourOfAKind    (0x0080)
 * Bit 8:  FullHouse      (0x0100)
 * Bit 9:  SmallStraight  (0x0200)
 * Bit 10: LargeStraight  (0x0400)
 * Bit 11: Dicee          (0x0800)
 * Bit 12: Chance         (0x1000)
 * ```
 *
 * # Returns
 *
 * JSON-serialized TurnAnalysisJs with recommendation and expected values.
 *
 * # Errors
 *
 * Returns an error if:
 * - Dice array is not exactly 5 values
 * - Dice values are not in range 1-6
 * - `rolls_remaining` is greater than 2
 */
export function analyze_turn(dice: Uint8Array, rolls_remaining: number, available_categories: number): any;

/**
 * Get metadata for all categories (names, sections)
 */
export function get_categories(): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly analyze_turn: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly get_categories: () => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
