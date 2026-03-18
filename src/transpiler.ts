import type { DiscoveredItem, TargetAgent, TranspiledOutput } from './types.ts';

/**
 * A transpiler converts a canonical context item into agent-specific output.
 *
 * Each target agent gets its own transpiler implementation. The installer
 * calls `canTranspile()` to check applicability, then `transform()` to
 * produce the file(s) to write.
 */
export interface Transpiler<T> {
  /** Whether this transpiler can handle the given discovered item. */
  canTranspile(item: DiscoveredItem): boolean;

  /** Transform a parsed canonical item into agent-specific output. */
  transform(item: T, targetAgent: TargetAgent): TranspiledOutput;
}
