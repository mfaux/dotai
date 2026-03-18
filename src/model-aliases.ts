import { readFile } from 'fs/promises';
import { join } from 'path';
import type { TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Model alias resolver
//
// Maps canonical model names (e.g., "claude-sonnet-4") to agent-specific
// model identifiers. This enables AGENT.md and PROMPT.md authors to use
// portable model names that resolve correctly for each target agent.
//
// User/project overrides can be defined in package.json under the
// "dotai"."modelAliases" key:
//
//   {
//     "dotai": {
//       "modelAliases": {
//         "claude-sonnet-4": {
//           "github-copilot": "my-custom-sonnet-id"
//         }
//       }
//     }
//   }
//
// Reference: .plans/prd-deferred-items.md § Model aliases
// ---------------------------------------------------------------------------

/**
 * Result of resolving a model alias for a target agent.
 */
export interface ModelResolution {
  /** The resolved model name, or null if no mapping exists. */
  model: string | null;
  /** Warning message when the model is dropped or unmapped. */
  warning?: string;
}

/**
 * Built-in model alias map.
 *
 * Keys are canonical model names. Values map each target agent to the
 * model identifier it expects, or `null` if the agent does not support
 * model selection for that model.
 *
 * Agents that don't support model selection at all (Cursor, Windsurf, Cline)
 * always map to `null`.
 */
const BUILT_IN_ALIASES: Record<string, Partial<Record<TargetAgent, string | null>>> = {
  // --- Anthropic models ---
  'claude-sonnet-4': {
    'github-copilot': 'claude-sonnet-4',
    'claude-code': 'claude-sonnet-4',
    cursor: null,
    windsurf: null,
    cline: null,
  },
  'claude-opus-4': {
    'github-copilot': 'claude-opus-4',
    'claude-code': 'claude-opus-4',
    cursor: null,
    windsurf: null,
    cline: null,
  },
  'claude-haiku-3.5': {
    'github-copilot': 'claude-3.5-haiku',
    'claude-code': 'claude-3-5-haiku-latest',
    cursor: null,
    windsurf: null,
    cline: null,
  },

  // --- OpenAI models ---
  'gpt-4o': {
    'github-copilot': 'gpt-4o',
    'claude-code': null,
    cursor: null,
    windsurf: null,
    cline: null,
  },
  'gpt-4.1': {
    'github-copilot': 'gpt-4.1',
    'claude-code': null,
    cursor: null,
    windsurf: null,
    cline: null,
  },
  'o3-mini': {
    'github-copilot': 'o3-mini',
    'claude-code': null,
    cursor: null,
    windsurf: null,
    cline: null,
  },

  // --- Google models ---
  'gemini-2.5-pro': {
    'github-copilot': 'gemini-2.5-pro',
    'claude-code': null,
    cursor: null,
    windsurf: null,
    cline: null,
  },
};

/**
 * Resolve a canonical model name for a target agent.
 *
 * Resolution order:
 * 1. User/project overrides (if provided)
 * 2. Built-in alias map
 * 3. Unknown model → return null with warning
 *
 * @param canonicalModel - The canonical model name from AGENT.md/PROMPT.md
 * @param targetAgent - The target agent to resolve for
 * @param userOverrides - Optional user/project override map (model → agent → identifier)
 * @returns The resolved model name and optional warning
 */
export function resolveModel(
  canonicalModel: string,
  targetAgent: TargetAgent,
  userOverrides?: Record<string, Record<string, string | null>>
): ModelResolution {
  // 1. Check user overrides first (highest precedence)
  if (userOverrides) {
    const overrideEntry = userOverrides[canonicalModel];
    if (overrideEntry && targetAgent in overrideEntry) {
      const resolved = overrideEntry[targetAgent];
      if (resolved === null) {
        return {
          model: null,
          warning: `Model "${canonicalModel}" explicitly set to null for ${targetAgent} in user overrides — model field omitted`,
        };
      }
      return { model: resolved ?? null };
    }
  }

  // 2. Check built-in aliases
  const builtIn = BUILT_IN_ALIASES[canonicalModel];
  if (builtIn) {
    if (targetAgent in builtIn) {
      const resolved = builtIn[targetAgent];
      if (resolved === null) {
        return {
          model: null,
          warning: `Model "${canonicalModel}" is not supported by ${targetAgent} — model field omitted`,
        };
      }
      return { model: resolved ?? null };
    }
    // Model is known but no mapping for this specific agent
    return {
      model: null,
      warning: `Model "${canonicalModel}" has no mapping for ${targetAgent} — model field omitted`,
    };
  }

  // 3. Unknown model — not in any alias map
  return {
    model: null,
    warning: `Unknown model "${canonicalModel}" — no alias mapping found, model field omitted`,
  };
}

/**
 * Get the list of all known canonical model names from the built-in alias map.
 */
export function getKnownModels(): string[] {
  return Object.keys(BUILT_IN_ALIASES);
}

// ---------------------------------------------------------------------------
// User override loading
// ---------------------------------------------------------------------------

/** Shape of the model overrides map (model → agent → identifier | null). */
export type ModelOverrides = Record<string, Record<string, string | null>>;

/**
 * Load model alias overrides from the project's `package.json`.
 *
 * Reads `package.json` at `projectRoot`, looks for `"dotai"."modelAliases"`,
 * and returns the overrides map if valid. Returns `undefined` if no overrides
 * are found or if the file/field is missing or malformed.
 *
 * Expected format in package.json:
 * ```json
 * {
 *   "dotai": {
 *     "modelAliases": {
 *       "claude-sonnet-4": {
 *         "github-copilot": "my-custom-id"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export async function loadModelOverrides(projectRoot: string): Promise<ModelOverrides | undefined> {
  try {
    const pkgPath = join(projectRoot, 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);

    const dotaiConfig = pkg?.dotai;
    if (!dotaiConfig || typeof dotaiConfig !== 'object') {
      return undefined;
    }

    const aliases = dotaiConfig.modelAliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      return undefined;
    }

    // Validate structure: Record<string, Record<string, string | null>>
    const result: ModelOverrides = {};
    for (const [model, agentMap] of Object.entries(aliases)) {
      if (typeof model !== 'string') continue;
      if (!agentMap || typeof agentMap !== 'object' || Array.isArray(agentMap)) {
        console.warn(
          `[dotai] Invalid modelAliases entry for "${model}" in package.json — expected an object, skipping`
        );
        continue;
      }

      const validatedAgentMap: Record<string, string | null> = {};
      for (const [agent, value] of Object.entries(agentMap as Record<string, unknown>)) {
        if (value === null || typeof value === 'string') {
          validatedAgentMap[agent] = value;
        } else {
          console.warn(
            `[dotai] Invalid modelAliases value for "${model}"."${agent}" in package.json — expected string or null, skipping`
          );
        }
      }

      if (Object.keys(validatedAgentMap).length > 0) {
        result[model] = validatedAgentMap;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    // File not found, parse error, etc. — silently return undefined
    return undefined;
  }
}
