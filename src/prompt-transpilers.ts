import type { Transpiler } from './transpiler.ts';
import type {
  CanonicalPrompt,
  ContextFormat,
  DiscoveredItem,
  TargetAgent,
  TranspiledOutput,
} from './types.ts';
import { parsePromptContent } from './prompt-parser.ts';
import { getTargetAgentConfig } from './target-agents.ts';
import { resolveModel, type ModelOverrides } from './model-aliases.ts';
import { quoteYaml } from './rule-transpilers.ts';
import { mergeOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Prompt transpilers — canonical PROMPT.md → per-agent output
//
// Each transpiler converts a CanonicalPrompt into the target agent's native
// prompt/command file format. The `Transpiler<CanonicalPrompt>` interface
// guarantees consistent shape across all implementations.
//
// Only Copilot and Claude Code support canonical prompt transpilation.
// Windsurf supports native passthrough only. Cursor and Cline have no
// prompt/command system.
//
// Reference: dotai-plan.md Phase 5 (Transpilation Engine)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Copilot prompt transpiler (.github/prompts/*.prompt.md)
//
// Copilot prompt files use YAML frontmatter with:
//   - description: string
//   - agent: string (optional)
//   - model: string (optional)
//   - argumentHint: string (optional)
//   - tools: string[] (optional)
// ---------------------------------------------------------------------------

export const copilotPromptTranspiler: Transpiler<CanonicalPrompt> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'prompt' && item.format === 'canonical';
  },

  transform(prompt: CanonicalPrompt, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('github-copilot');
    const lines: string[] = ['---'];
    lines.push(`description: ${quoteYaml(prompt.description)}`);

    if (prompt.agent) {
      lines.push(`agent: ${quoteYaml(prompt.agent)}`);
    }
    if (prompt.model) {
      lines.push(`model: ${quoteYaml(prompt.model)}`);
    }
    if (prompt.argumentHint) {
      lines.push(`argumentHint: ${quoteYaml(prompt.argumentHint)}`);
    }
    if (prompt.tools.length > 0) {
      lines.push('tools:');
      for (const tool of prompt.tools) {
        lines.push(`  - ${tool}`);
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(prompt.body);
    lines.push('');

    return {
      filename: `${prompt.name}${config.promptsConfig!.extension}`,
      content: lines.join('\n'),
      outputDir: config.promptsConfig!.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code prompt transpiler (.claude/commands/*.md)
//
// Claude Code custom commands use minimal structure:
//   - Description as a blockquote at the top
//   - Body passed through as-is (Claude interprets $ARGUMENTS, @file, !`cmd`)
// ---------------------------------------------------------------------------

export const claudeCodePromptTranspiler: Transpiler<CanonicalPrompt> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'prompt' && item.format === 'canonical';
  },

  transform(prompt: CanonicalPrompt, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('claude-code');

    // Claude Code commands use a description blockquote at the top,
    // followed by the body passed through unchanged.
    const lines: string[] = [];

    if (prompt.description) {
      lines.push(`> ${prompt.description}`);
      lines.push('');
    }

    lines.push(prompt.body);
    lines.push('');

    return {
      filename: `${prompt.name}${config.promptsConfig!.extension}`,
      content: lines.join('\n'),
      outputDir: config.promptsConfig!.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Native passthrough handler
//
// Native prompt items (format: "native:<agent>") skip transpilation entirely.
// They are installed as-is to the matching agent's output directory.
//
// Supports:
// - Copilot: .github/prompts/*.prompt.md
// - Claude Code: .claude/commands/*.md
// - Windsurf: .windsurf/workflows/*.md (native passthrough only, no canonical)
// ---------------------------------------------------------------------------

/**
 * Create a TranspiledOutput for a native passthrough prompt.
 * The content is passed through unchanged — no transpilation occurs.
 *
 * Returns `null` if the target agent doesn't match the item's native format
 * or if the agent has no prompt support.
 */
export function nativePromptPassthrough(
  item: DiscoveredItem,
  targetAgent: TargetAgent
): TranspiledOutput | null {
  const expectedFormat: ContextFormat = `native:${targetAgent}`;
  if (item.format !== expectedFormat) {
    return null;
  }

  const config = getTargetAgentConfig(targetAgent);
  const promptsConfig = config.promptsConfig;

  // If agent has no prompts config, check for native discovery only
  // (e.g., Windsurf has nativePromptDiscovery but no promptsConfig for canonical)
  if (!promptsConfig && !config.nativePromptDiscovery) {
    return null;
  }

  // Use promptsConfig if available, otherwise use nativePromptDiscovery source dir
  const outputDir = promptsConfig?.outputDir ?? config.nativePromptDiscovery!.sourceDir;
  const extension = promptsConfig?.extension ?? '.md';
  const filename = `${item.name}${extension}`;

  return {
    filename,
    content: item.rawContent,
    outputDir,
    mode: 'write',
  };
}

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

/** Map of target agents to their prompt transpilers. Only agents that support canonical prompts. */
export const promptTranspilers: Partial<Record<TargetAgent, Transpiler<CanonicalPrompt>>> = {
  'github-copilot': copilotPromptTranspiler,
  'claude-code': claudeCodePromptTranspiler,
  // cursor: not supported — no prompt/command system
  // windsurf: native passthrough only — no canonical transpilation
  // cline: not supported — no prompt/command system
};

/**
 * Transpile a canonical prompt for a specific target agent.
 *
 * Parses the raw content to extract the CanonicalPrompt, then delegates
 * to the appropriate transpiler. Returns `null` if parsing fails or the
 * agent doesn't support prompts.
 *
 * @param item - The discovered prompt item to transpile
 * @param targetAgent - The target agent to transpile for
 * @param modelOverrides - Optional user/project model alias overrides
 */
export function transpilePrompt(
  item: DiscoveredItem,
  targetAgent: TargetAgent,
  modelOverrides?: ModelOverrides
): TranspiledOutput | null {
  // Native passthrough: install as-is to matching agent
  if (item.format !== 'canonical') {
    return nativePromptPassthrough(item, targetAgent);
  }

  const transpiler = promptTranspilers[targetAgent];
  if (!transpiler) {
    return null; // Agent doesn't support canonical prompt transpilation
  }

  const parsed = parsePromptContent(item.rawContent);
  if (!parsed.ok) {
    return null;
  }

  // Merge per-agent overrides on top of base fields
  const prompt = mergeOverrides(parsed.prompt, targetAgent) as CanonicalPrompt;
  if (prompt.model) {
    const resolution = resolveModel(prompt.model, targetAgent, modelOverrides);
    if (resolution.warning) {
      // Log the warning — model will be dropped or remapped
      console.warn(`[dotai] ${resolution.warning}`);
    }
    // Replace canonical model with resolved value (or undefined to omit)
    prompt.model = resolution.model ?? undefined;
  }

  return transpiler.transform(prompt, targetAgent);
}

/**
 * Transpile a canonical prompt for all target agents.
 *
 * Returns an array of TranspiledOutputs — one per agent that can
 * receive the transpiled prompt. Native passthrough items only produce
 * output for their matching agent.
 *
 * @param item - The discovered prompt item to transpile
 * @param agents - Target agents to transpile for
 * @param modelOverrides - Optional user/project model alias overrides
 */
export function transpilePromptForAllAgents(
  item: DiscoveredItem,
  agents: readonly TargetAgent[],
  modelOverrides?: ModelOverrides
): TranspiledOutput[] {
  const outputs: TranspiledOutput[] = [];

  for (const agent of agents) {
    const output = transpilePrompt(item, agent, modelOverrides);
    if (output !== null) {
      outputs.push(output);
    }
  }

  return outputs;
}
