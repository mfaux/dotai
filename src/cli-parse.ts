import type { ContextType } from './types.ts';

/** Valid context types accepted by --type flags. */
export const VALID_CONTEXT_TYPES: readonly ContextType[] = [
  'skill',
  'rule',
  'prompt',
  'agent',
] as const;

/**
 * Consume multi-value arguments from an args array starting at position `start`.
 * Reads consecutive non-flag arguments (those not starting with '-') and returns
 * them along with the updated index.
 *
 * If `splitCommas` is true, each argument is further split on commas and empty
 * segments are filtered out.
 *
 * @returns An object with `values` (the consumed strings) and `nextIndex` (the
 *          index to resume parsing from — suitable for assigning back to the
 *          loop counter after decrementing by 1).
 */
export function consumeMultiValues(
  args: string[],
  start: number,
  options?: { splitCommas?: boolean }
): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  let i = start;
  while (i < args.length && args[i] && !args[i]!.startsWith('-')) {
    if (options?.splitCommas) {
      for (const val of args[i]!.split(',')) {
        const trimmed = val.trim();
        if (trimmed) values.push(trimmed);
      }
    } else {
      values.push(args[i]!);
    }
    i++;
  }
  return { values, nextIndex: i };
}

/**
 * Parse and validate `--type` flag values from a CLI args array.
 *
 * Consumes one or more values after `--type`/`-t`, splits on commas,
 * normalizes to lowercase, validates against {@link VALID_CONTEXT_TYPES},
 * and deduplicates.
 *
 * @param existing - Previously accumulated type values (for repeated flags).
 * @param args     - The full args array.
 * @param start    - Index of the first value token (i.e. the position after `--type`).
 * @param onError  - Called with an error message when an invalid type is encountered.
 *                   Implementations should typically print the message and exit.
 * @returns An object with:
 *   - `types`: the deduplicated, validated type array
 *   - `nextIndex`: the index to resume parsing from (assign `nextIndex - 1` to
 *     the loop counter when using a `for` loop with `i++`)
 */
export function parseTypeFlag(
  existing: ContextType[],
  args: string[],
  start: number,
  onError: (message: string) => never
): { types: ContextType[]; nextIndex: number } {
  const { values, nextIndex } = consumeMultiValues(args, start, { splitCommas: true });

  if (values.length === 0) {
    onError(`--type requires a value. Valid types: ${VALID_CONTEXT_TYPES.join(', ')}`);
  }

  const types = [...existing];
  for (const val of values) {
    const lower = val.toLowerCase();
    if (!VALID_CONTEXT_TYPES.includes(lower as ContextType)) {
      onError(`Invalid type: ${lower}. Valid types: ${VALID_CONTEXT_TYPES.join(', ')}`);
    }
    if (!types.includes(lower as ContextType)) {
      types.push(lower as ContextType);
    }
  }

  return { types, nextIndex };
}
