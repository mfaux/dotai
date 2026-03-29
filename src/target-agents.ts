import type { TargetAgent, ContextType } from './types.ts';

// ---------------------------------------------------------------------------
// Target agent registry for dotai transpilation (rules, skills, prompts, agents)
//
// This is separate from the upstream `agents.ts` (skills-only registry with
// 40+ agents) to avoid merge conflicts and keep concerns separated. The
// upstream registry manages skill installation paths; this module manages
// the expanded context-type paths needed for dotai transpilation.
// ---------------------------------------------------------------------------

/**
 * Configuration for one context type within a target agent.
 */
export interface ContextTypeConfig {
  /** Directory to install transpiled outputs (relative to project root). */
  outputDir: string;
  /** File extension for transpiled output files (including dot). */
  extension: string;
}

/**
 * Configuration for native passthrough discovery within a source repo.
 * Used to find agent-native rule files that should be installed without
 * transpilation.
 */
export interface NativeRuleDiscovery {
  /** Directory to search for native rule files (relative to repo root). */
  sourceDir: string;
  /** Glob pattern for matching native rule files within sourceDir. */
  pattern: string;
}

/**
 * Configuration for native prompt file discovery within a source repo.
 * Used to find agent-native prompt/command files that should be installed
 * without transpilation.
 */
export interface NativePromptDiscovery {
  /** Directory to search for native prompt files (relative to repo root). */
  sourceDir: string;
  /** Glob pattern for matching native prompt files within sourceDir. */
  pattern: string;
}

/**
 * Configuration for native agent file discovery within a source repo.
 * Used to find agent-native agent definition files that should be installed
 * without transpilation.
 */
export interface NativeAgentDiscovery {
  /** Directory to search for native agent files (relative to repo root). */
  sourceDir: string;
  /** Glob pattern for matching native agent files within sourceDir. */
  pattern: string;
}

/**
 * Registry entry for a target agent — maps context types to their
 * output paths and native discovery locations.
 */
export interface TargetAgentConfig {
  /** Machine-readable identifier. */
  name: TargetAgent;
  /** Human-readable display name. */
  displayName: string;
  /** Skills output directory (relative to project root). */
  skillsDir: string;
  /** Rules output configuration (per-rule file output). */
  rulesConfig: ContextTypeConfig;
  /** Native rule file discovery locations in source repos. */
  nativeRuleDiscovery: NativeRuleDiscovery;
  /** Prompts output configuration. Undefined = agent does not support prompts. */
  promptsConfig?: ContextTypeConfig;
  /** Native prompt file discovery locations in source repos. */
  nativePromptDiscovery?: NativePromptDiscovery;
  /** Agents output configuration. Undefined = agent does not support custom agents. */
  agentsConfig?: ContextTypeConfig;
  /** Native agent file discovery locations in source repos. */
  nativeAgentDiscovery?: NativeAgentDiscovery;
}

/**
 * The four target agents for dotai transpilation, with their
 * rules + skills path configurations.
 *
 * Reference: dotai-plan.md Phase 4 (Agent Registry)
 */
export const targetAgents: Record<TargetAgent, TargetAgentConfig> = {
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    rulesConfig: {
      outputDir: '.github/instructions',
      extension: '.instructions.md',
    },
    nativeRuleDiscovery: {
      sourceDir: '.github/instructions',
      pattern: '*.instructions.md',
    },
    promptsConfig: {
      outputDir: '.github/prompts',
      extension: '.prompt.md',
    },
    nativePromptDiscovery: {
      sourceDir: '.github/prompts',
      pattern: '*.prompt.md',
    },
    agentsConfig: {
      outputDir: '.github/agents',
      extension: '.agent.md',
    },
    nativeAgentDiscovery: {
      sourceDir: '.github/agents',
      pattern: '*.agent.md',
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    rulesConfig: {
      outputDir: '.claude/rules',
      extension: '.md',
    },
    nativeRuleDiscovery: {
      sourceDir: '.claude/rules',
      pattern: '*.md',
    },
    promptsConfig: {
      outputDir: '.claude/commands',
      extension: '.md',
    },
    nativePromptDiscovery: {
      sourceDir: '.claude/commands',
      pattern: '*.md',
    },
    agentsConfig: {
      outputDir: '.claude/agents',
      extension: '.md',
    },
    nativeAgentDiscovery: {
      sourceDir: '.claude/agents',
      pattern: '*.md',
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    rulesConfig: {
      outputDir: '.cursor/rules',
      extension: '.mdc',
    },
    nativeRuleDiscovery: {
      sourceDir: '.cursor/rules',
      pattern: '*.mdc',
    },
    // Cursor has no prompt/command system
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skills',
    rulesConfig: {
      outputDir: '.opencode/rules',
      extension: '.md',
    },
    nativeRuleDiscovery: {
      sourceDir: '.opencode/rules',
      pattern: '*.md',
    },
    promptsConfig: {
      outputDir: '.opencode/commands',
      extension: '.md',
    },
    nativePromptDiscovery: {
      sourceDir: '.opencode/commands',
      pattern: '*.md',
    },
    agentsConfig: {
      outputDir: '.opencode/agents',
      extension: '.md',
    },
    nativeAgentDiscovery: {
      sourceDir: '.opencode/agents',
      pattern: '*.md',
    },
  },
};

/** All target agent identifiers. */
export const TARGET_AGENTS: readonly TargetAgent[] = Object.keys(targetAgents) as TargetAgent[];

/**
 * Get the target agent configuration for a given agent.
 */
export function getTargetAgentConfig(agent: TargetAgent): TargetAgentConfig {
  return targetAgents[agent];
}

/**
 * Get the output directory for a specific context type and target agent.
 * Returns `undefined` if the agent does not support the given context type
 * (e.g., prompts on Cursor/Cline).
 */
export function getOutputDir(agent: TargetAgent, contextType: ContextType): string | undefined {
  const config = targetAgents[agent];
  if (contextType === 'skill') {
    return config.skillsDir;
  }
  if (contextType === 'prompt') {
    return config.promptsConfig?.outputDir;
  }
  if (contextType === 'agent') {
    return config.agentsConfig?.outputDir;
  }
  return config.rulesConfig.outputDir;
}

/**
 * Get the file extension for transpiled rule output for a given target agent.
 */
export function getRuleExtension(agent: TargetAgent): string {
  return targetAgents[agent].rulesConfig.extension;
}

/**
 * Get the file extension for transpiled prompt output for a given target agent.
 * Returns `undefined` if the agent does not support canonical prompt transpilation.
 */
export function getPromptExtension(agent: TargetAgent): string | undefined {
  return targetAgents[agent].promptsConfig?.extension;
}

/**
 * Get the file extension for transpiled agent output for a given target agent.
 * Returns `undefined` if the agent does not support custom agent transpilation.
 */
export function getAgentExtension(agent: TargetAgent): string | undefined {
  return targetAgents[agent].agentsConfig?.extension;
}
