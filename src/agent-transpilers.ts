import type { Transpiler } from './transpiler.ts';
import type {
  CanonicalAgent,
  ContextFormat,
  DiscoveredItem,
  TargetAgent,
  TranspiledOutput,
} from './types.ts';
import { parseAgentContent } from './agent-parser.ts';
import { getTargetAgentConfig } from './target-agents.ts';
import { resolveModel, type ModelOverrides } from './model-aliases.ts';
import { quoteYaml } from './rule-transpilers.ts';
import { mergeOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Agent transpilers — canonical AGENT.md → per-agent output
//
// Each transpiler converts a CanonicalAgent into the target agent's native
// agent file format. The `Transpiler<CanonicalAgent>` interface guarantees
// consistent shape across all implementations.
//
// Only Copilot and Claude Code support agent transpilation. Cursor, Windsurf,
// and Cline have no agent systems.
//
// Reference: dotai-plan.md Phase 5 (Transpilation Engine)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Copilot agent transpiler (.github/agents/*.agent.md)
//
// Copilot agent files use YAML frontmatter with:
//   - name: string
//   - description: string
//   - model: string (optional)
//   - tools: string[] (optional)
// ---------------------------------------------------------------------------

export const copilotAgentTranspiler: Transpiler<CanonicalAgent> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'agent' && item.format === 'canonical';
  },

  transform(agent: CanonicalAgent, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('github-copilot');
    const lines: string[] = ['---'];
    lines.push(`name: ${quoteYaml(agent.name)}`);
    lines.push(`description: ${quoteYaml(agent.description)}`);

    if (agent.model) {
      lines.push(`model: ${quoteYaml(agent.model)}`);
    }
    if (agent.tools && agent.tools.length > 0) {
      lines.push('tools:');
      for (const tool of agent.tools) {
        lines.push(`  - ${tool}`);
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(agent.body);
    lines.push('');

    return {
      filename: `${agent.name}${config.agentsConfig!.extension}`,
      content: lines.join('\n'),
      outputDir: config.agentsConfig!.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code agent transpiler (.claude/agents/*.md)
//
// Claude Code agent files use YAML frontmatter with:
//   - name: string
//   - description: string
//   - model: string (optional)
//   - tools: string[] (optional)
//   - disallowed-tools: string[] (optional)
//   - max-turns: number (optional)
//   - background: boolean (optional)
// ---------------------------------------------------------------------------

export const claudeCodeAgentTranspiler: Transpiler<CanonicalAgent> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'agent' && item.format === 'canonical';
  },

  transform(agent: CanonicalAgent, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('claude-code');
    const lines: string[] = ['---'];
    lines.push(`name: ${quoteYaml(agent.name)}`);
    lines.push(`description: ${quoteYaml(agent.description)}`);

    if (agent.model) {
      lines.push(`model: ${quoteYaml(agent.model)}`);
    }
    if (agent.tools && agent.tools.length > 0) {
      lines.push('tools:');
      for (const tool of agent.tools) {
        lines.push(`  - ${tool}`);
      }
    }
    if (agent.disallowedTools && agent.disallowedTools.length > 0) {
      lines.push('disallowed-tools:');
      for (const tool of agent.disallowedTools) {
        lines.push(`  - ${tool}`);
      }
    }
    if (agent.maxTurns !== undefined) {
      lines.push(`max-turns: ${agent.maxTurns}`);
    }
    if (agent.background !== undefined) {
      lines.push(`background: ${agent.background}`);
    }

    lines.push('---');
    lines.push('');
    lines.push(agent.body);
    lines.push('');

    return {
      filename: `${agent.name}${config.agentsConfig!.extension}`,
      content: lines.join('\n'),
      outputDir: config.agentsConfig!.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Native passthrough handler
//
// Native agent items (format: "native:<agent>") skip transpilation entirely.
// They are installed as-is to the matching agent's output directory.
//
// Supports:
// - Copilot: .github/agents/*.agent.md
// - Claude Code: .claude/agents/*.md
// ---------------------------------------------------------------------------

/**
 * Create a TranspiledOutput for a native passthrough agent.
 * The content is passed through unchanged — no transpilation occurs.
 *
 * Returns `null` if the target agent doesn't match the item's native format
 * or if the agent has no agent support.
 */
export function nativeAgentPassthrough(
  item: DiscoveredItem,
  targetAgent: TargetAgent
): TranspiledOutput | null {
  const expectedFormat: ContextFormat = `native:${targetAgent}`;
  if (item.format !== expectedFormat) {
    return null;
  }

  const config = getTargetAgentConfig(targetAgent);
  const agentsConfig = config.agentsConfig;

  if (!agentsConfig && !config.nativeAgentDiscovery) {
    return null;
  }

  const outputDir = agentsConfig?.outputDir ?? config.nativeAgentDiscovery!.sourceDir;
  const extension = agentsConfig?.extension ?? '.md';
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

/** Map of target agents to their agent transpilers. Only agents that support canonical agents. */
export const agentTranspilers: Partial<Record<TargetAgent, Transpiler<CanonicalAgent>>> = {
  'github-copilot': copilotAgentTranspiler,
  'claude-code': claudeCodeAgentTranspiler,
  // cursor: not supported — no agent system
  // windsurf: not supported — no agent system
  // cline: not supported — no agent system
};

/**
 * Transpile a canonical agent for a specific target agent.
 *
 * Parses the raw content to extract the CanonicalAgent, then delegates
 * to the appropriate transpiler. Returns `null` if parsing fails or the
 * agent doesn't support agents.
 *
 * @param item - The discovered agent item to transpile
 * @param targetAgent - The target agent to transpile for
 * @param modelOverrides - Optional user/project model alias overrides
 */
export function transpileAgent(
  item: DiscoveredItem,
  targetAgent: TargetAgent,
  modelOverrides?: ModelOverrides
): TranspiledOutput | null {
  // Native passthrough: install as-is to matching agent
  if (item.format !== 'canonical') {
    return nativeAgentPassthrough(item, targetAgent);
  }

  const transpiler = agentTranspilers[targetAgent];
  if (!transpiler) {
    return null; // Agent doesn't support canonical agent transpilation
  }

  const parsed = parseAgentContent(item.rawContent);
  if (!parsed.ok) {
    return null;
  }

  // Merge per-agent overrides on top of base fields
  const agent = mergeOverrides(parsed.agent, targetAgent) as CanonicalAgent;
  if (agent.model) {
    const resolution = resolveModel(agent.model, targetAgent, modelOverrides);
    if (resolution.warning) {
      // Log the warning — model will be dropped or remapped
      console.warn(`[dotai] ${resolution.warning}`);
    }
    // Replace canonical model with resolved value (or undefined to omit)
    agent.model = resolution.model ?? undefined;
  }

  return transpiler.transform(agent, targetAgent);
}

/**
 * Transpile a canonical agent for all target agents.
 *
 * Returns an array of TranspiledOutputs — one per agent that can
 * receive the transpiled agent. Native passthrough items only produce
 * output for their matching agent.
 *
 * @param item - The discovered agent item to transpile
 * @param agents - Target agents to transpile for
 * @param modelOverrides - Optional user/project model alias overrides
 */
export function transpileAgentForAllAgents(
  item: DiscoveredItem,
  agents: readonly TargetAgent[],
  modelOverrides?: ModelOverrides
): TranspiledOutput[] {
  const outputs: TranspiledOutput[] = [];

  for (const agent of agents) {
    const output = transpileAgent(item, agent, modelOverrides);
    if (output !== null) {
      outputs.push(output);
    }
  }

  return outputs;
}
