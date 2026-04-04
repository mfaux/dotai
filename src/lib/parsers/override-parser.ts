import type { TargetAgent } from '../types.ts';
import { TARGET_AGENTS } from '../agents/index.ts';

// ---------------------------------------------------------------------------
// Shared override extraction for per-agent frontmatter overrides
//
// Canonical files (PROMPT.md, AGENT.md, INSTRUCTIONS.md) can include agent-namespaced
// blocks in YAML frontmatter. When transpiling for a target agent, its
// overrides are merged on top of the base fields.
// ---------------------------------------------------------------------------

/** Result of extracting overrides from frontmatter data. */
export interface ExtractOverridesResult<T> {
  /** Extracted overrides keyed by target agent. Undefined if no overrides found. */
  overrides?: Partial<Record<TargetAgent, T>>;
  /** Warnings for unknown agent keys. */
  warnings: string[];
}

/**
 * The set of known target agent IDs, used to detect override blocks.
 * Other keys that look like agent IDs (contain a hyphen or match common
 * agent name patterns) but aren't in this set produce warnings.
 */
const TARGET_AGENT_SET = new Set<string>(TARGET_AGENTS);

/**
 * Extract per-agent override blocks from parsed frontmatter data.
 *
 * Iterates over top-level keys in `data` that match a TargetAgent value.
 * For each, calls `fieldExtractor` to validate and extract override fields.
 * Keys matching no known TargetAgent produce a warning.
 *
 * @param data - The parsed frontmatter data object.
 * @param baseFieldNames - Set of field names that belong to the base schema
 *   (not agent overrides). Used to distinguish override blocks from base fields.
 * @param fieldExtractor - Callback that extracts and validates fields from an
 *   override block. Returns `{ fields, error }` where `error` is set on
 *   validation failure.
 * @returns Extracted overrides and any warnings.
 */
export function extractOverrides<T>(
  data: Record<string, unknown>,
  baseFieldNames: ReadonlySet<string>,
  fieldExtractor: (
    agentData: Record<string, unknown>,
    agentName: TargetAgent
  ) => { fields: T; error: string | null }
): ExtractOverridesResult<T> {
  const overrides: Partial<Record<TargetAgent, T>> = {};
  const warnings: string[] = [];
  let hasOverrides = false;

  for (const key of Object.keys(data)) {
    // Skip known base fields
    if (baseFieldNames.has(key)) continue;

    if (TARGET_AGENT_SET.has(key)) {
      const agentKey = key as TargetAgent;
      const agentData = data[key];

      // Override block must be an object
      if (agentData === null || agentData === undefined) continue;
      if (typeof agentData !== 'object' || Array.isArray(agentData)) {
        warnings.push(`override block for "${key}" must be an object`);
        continue;
      }

      const { fields, error } = fieldExtractor(agentData as Record<string, unknown>, agentKey);
      if (error) {
        // Return error as a warning prefixed with agent name
        warnings.push(`${key}: ${error}`);
        continue;
      }

      overrides[agentKey] = fields;
      hasOverrides = true;
    } else if (!baseFieldNames.has(key)) {
      // Unknown key — warn if it looks like it could be an agent name
      warnings.push(`unknown frontmatter key "${key}" (not a recognized target agent)`);
    }
  }

  return {
    overrides: hasOverrides ? overrides : undefined,
    warnings,
  };
}

/**
 * Merge a target agent's override block on top of the base canonical object.
 *
 * Returns a new object with the override fields shallow-merged over the base.
 * If no override exists for the target agent, returns the original object.
 *
 * The `overrides` field itself is stripped from the result to keep the
 * merged object clean for transpiler consumption.
 */
export function mergeOverrides<T extends { overrides?: Partial<Record<TargetAgent, Partial<T>>> }>(
  canonical: T,
  targetAgent: TargetAgent
): Omit<T, 'overrides'> {
  const agentOverrides = canonical.overrides?.[targetAgent];
  // Strip overrides from the result regardless
  const { overrides: _, ...base } = canonical;

  if (!agentOverrides) {
    return base as Omit<T, 'overrides'>;
  }

  // Shallow merge: override fields win over base fields
  return { ...base, ...agentOverrides } as Omit<T, 'overrides'>;
}
