import type { Transpiler } from './transpiler.ts';
import type {
  CanonicalRule,
  ContextFormat,
  DiscoveredItem,
  TargetAgent,
  TranspiledOutput,
} from './types.ts';
import { parseRuleContent } from './rule-parser.ts';
import { getTargetAgentConfig } from './target-agents.ts';
import { mergeOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Rule transpilers — canonical RULES.md → per-agent output
//
// Each transpiler converts a CanonicalRule into the target agent's native
// rule file format. The `Transpiler<CanonicalRule>` interface guarantees
// consistent shape across all implementations.
//
// Reference: dotai-plan.md Phase 5 (Transpilation Engine)
// Activation mapping: dotai-plan.md Phase 2 (Activation mapping table)
// ---------------------------------------------------------------------------

/**
 * Quote a string value for safe inclusion in YAML frontmatter.
 * Wraps the value in double quotes and escapes internal double-quote
 * and backslash characters. This prevents YAML injection from values
 * containing colons, quotes, or other special characters.
 */
export function quoteYaml(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ---------------------------------------------------------------------------
// Cursor transpiler (.cursor/rules/*.mdc)
//
// Cursor uses YAML frontmatter with:
//   - description: string
//   - globs: string (comma-separated) — only when activation is "glob"
//   - alwaysApply: boolean — true when activation is "always"
// ---------------------------------------------------------------------------

function cursorAlwaysApply(rule: CanonicalRule): boolean {
  return rule.activation === 'always';
}

function cursorGlobs(rule: CanonicalRule): string | undefined {
  if (rule.activation === 'glob' && rule.globs.length > 0) {
    return rule.globs.join(', ');
  }
  return undefined;
}

export const cursorRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('cursor');
    const lines: string[] = ['---'];
    lines.push(`description: ${quoteYaml(rule.description)}`);

    const globs = cursorGlobs(rule);
    if (globs !== undefined) {
      lines.push(`globs: ${globs}`);
    }

    lines.push(`alwaysApply: ${cursorAlwaysApply(rule)}`);
    lines.push('---');
    lines.push('');
    lines.push(rule.body);
    lines.push('');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: lines.join('\n'),
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Windsurf transpiler (.windsurf/rules/*.md)
//
// Windsurf uses YAML frontmatter with:
//   - trigger: "always_on" | "model_decision" | "manual" | "glob"
//   - description: string — used for model_decision context
//   - globs: string[] — when trigger is "glob"
// ---------------------------------------------------------------------------

function windsurfTrigger(rule: CanonicalRule): 'always_on' | 'model_decision' | 'manual' | 'glob' {
  switch (rule.activation) {
    case 'always':
      return 'always_on';
    case 'auto':
      return 'model_decision';
    case 'manual':
      return 'manual';
    case 'glob':
      return 'glob';
  }
}

export const windsurfRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('windsurf');
    const lines: string[] = ['---'];
    lines.push(`trigger: ${windsurfTrigger(rule)}`);
    lines.push(`description: ${quoteYaml(rule.description)}`);

    if (rule.activation === 'glob' && rule.globs.length > 0) {
      lines.push('globs:');
      for (const glob of rule.globs) {
        lines.push(`  - "${glob}"`);
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(rule.body);
    lines.push('');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: lines.join('\n'),
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Cline transpiler (.clinerules/*.md)
//
// Cline rule files are plain markdown. Activation and globs are expressed
// through the file's presence and content rather than structured frontmatter.
// For glob-scoped rules, we prepend a "Applies to:" line.
// ---------------------------------------------------------------------------

export const clineRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('cline');
    const lines: string[] = [];

    // Add description as a comment-style header
    lines.push(`# ${rule.name}`);
    lines.push('');
    lines.push(`> ${rule.description}`);
    lines.push('');

    if (rule.activation === 'glob' && rule.globs.length > 0) {
      lines.push(`**Applies to:** ${rule.globs.map((g) => `\`${g}\``).join(', ')}`);
      lines.push('');
    }

    lines.push(rule.body);
    lines.push('');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: lines.join('\n'),
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Copilot transpiler (.github/instructions/*.instructions.md)
//
// Copilot uses YAML frontmatter with:
//   - applyTo: string (glob pattern or "**" for always)
// ---------------------------------------------------------------------------

function copilotApplyTo(rule: CanonicalRule): string {
  if (rule.activation === 'glob' && rule.globs.length > 0) {
    // Copilot applyTo supports a single glob or comma-separated globs
    return rule.globs.join(', ');
  }
  // "always", "auto", "manual" all map to apply-to-all
  return '**';
}

export const copilotRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('github-copilot');
    const lines: string[] = ['---'];
    lines.push(`applyTo: "${copilotApplyTo(rule)}"`);
    lines.push('---');
    lines.push('');
    lines.push(rule.body);
    lines.push('');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: lines.join('\n'),
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code transpiler (.claude/rules/*.md)
//
// Claude Code rule files use YAML frontmatter with:
//   - description: string — for model-based activation
//   - globs: string[] — optional file scoping
// ---------------------------------------------------------------------------

export const claudeCodeRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('claude-code');
    const lines: string[] = ['---'];
    lines.push(`description: ${quoteYaml(rule.description)}`);

    if (rule.globs.length > 0) {
      lines.push('globs:');
      for (const glob of rule.globs) {
        lines.push(`  - "${glob}"`);
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(rule.body);
    lines.push('');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: lines.join('\n'),
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// OpenCode transpiler (.opencode/rules/*.md)
//
// OpenCode rule files are plain markdown — no YAML frontmatter. The body
// is written directly without any wrapper.
// ---------------------------------------------------------------------------

export const opencodeRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('opencode');

    return {
      filename: `${rule.name}${config.rulesConfig.extension}`,
      content: rule.body + '\n',
      outputDir: config.rulesConfig.outputDir,
      mode: 'write',
    };
  },
};

// ---------------------------------------------------------------------------
// Copilot append transpiler (→ AGENTS.md with markers)
//
// In append mode, rules are written as marked sections into a monolithic
// AGENTS.md file instead of individual .instructions.md files. The section
// body is plain markdown under a heading — no `applyTo` frontmatter.
// ---------------------------------------------------------------------------

export const copilotAppendRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const lines: string[] = [];

    lines.push(`## ${rule.name}`);
    lines.push('');
    lines.push(`> ${rule.description}`);
    lines.push('');

    if (rule.activation === 'glob' && rule.globs.length > 0) {
      lines.push(`**Applies to:** ${rule.globs.map((g) => `\`${g}\``).join(', ')}`);
      lines.push('');
    }

    lines.push(rule.body);

    return {
      filename: 'AGENTS.md',
      content: lines.join('\n'),
      outputDir: '.',
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code append transpiler (→ CLAUDE.md with markers)
//
// In append mode, rules are written as marked sections into a monolithic
// CLAUDE.md file instead of individual .md files in .claude/rules/.
// The section body is plain markdown under a heading — no frontmatter.
// ---------------------------------------------------------------------------

export const claudeCodeAppendRuleTranspiler: Transpiler<CanonicalRule> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'rule' && item.format === 'canonical';
  },

  transform(rule: CanonicalRule, _targetAgent: TargetAgent): TranspiledOutput {
    const lines: string[] = [];

    lines.push(`## ${rule.name}`);
    lines.push('');
    lines.push(`> ${rule.description}`);
    lines.push('');

    if (rule.globs.length > 0) {
      lines.push(`**Applies to:** ${rule.globs.map((g) => `\`${g}\``).join(', ')}`);
      lines.push('');
    }

    lines.push(rule.body);

    return {
      filename: 'CLAUDE.md',
      content: lines.join('\n'),
      outputDir: '.',
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// Native passthrough handler
//
// Native items (format: "native:<agent>") skip transpilation entirely.
// They are installed as-is to the matching agent's output directory.
// ---------------------------------------------------------------------------

/**
 * Create a TranspiledOutput for a native passthrough rule.
 * The content is passed through unchanged — no transpilation occurs.
 *
 * Returns `null` if the target agent doesn't match the item's native format.
 */
export function nativePassthrough(
  item: DiscoveredItem,
  targetAgent: TargetAgent
): TranspiledOutput | null {
  const expectedFormat: ContextFormat = `native:${targetAgent}`;
  if (item.format !== expectedFormat) {
    return null;
  }

  const config = getTargetAgentConfig(targetAgent);
  const extension = config.rulesConfig.extension;
  const filename = `${item.name}${extension}`;

  return {
    filename,
    content: item.rawContent,
    outputDir: config.rulesConfig.outputDir,
    mode: 'write',
  };
}

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

/** Map of target agents to their rule transpilers (per-rule file mode). */
export const ruleTranspilers: Record<TargetAgent, Transpiler<CanonicalRule>> = {
  cursor: cursorRuleTranspiler,
  windsurf: windsurfRuleTranspiler,
  cline: clineRuleTranspiler,
  'github-copilot': copilotRuleTranspiler,
  'claude-code': claudeCodeRuleTranspiler,
  opencode: opencodeRuleTranspiler,
};

/**
 * Map of target agents that support append mode to their append transpilers.
 * Only Copilot (AGENTS.md) and Claude Code (CLAUDE.md) have append variants;
 * the other agents always use per-rule files.
 */
export const appendRuleTranspilers: Partial<Record<TargetAgent, Transpiler<CanonicalRule>>> = {
  'github-copilot': copilotAppendRuleTranspiler,
  'claude-code': claudeCodeAppendRuleTranspiler,
};

/**
 * Transpile a canonical rule for a specific target agent.
 *
 * Parses the raw content to extract the CanonicalRule, then delegates
 * to the appropriate transpiler. Returns `null` if parsing fails.
 *
 * When `append` is true, uses the append-mode transpiler for agents that
 * support it (Copilot → AGENTS.md, Claude Code → CLAUDE.md). Agents
 * without append support fall back to per-rule file transpilation.
 */
export function transpileRule(
  item: DiscoveredItem,
  targetAgent: TargetAgent,
  append?: boolean
): TranspiledOutput | null {
  // Native passthrough: install as-is to matching agent
  if (item.format !== 'canonical') {
    return nativePassthrough(item, targetAgent);
  }

  const parsed = parseRuleContent(item.rawContent);
  if (!parsed.ok) {
    return null;
  }

  // Merge per-agent overrides on top of base fields
  const rule = mergeOverrides(parsed.rule, targetAgent) as CanonicalRule;

  // Use append transpiler if requested and available for this agent
  if (append) {
    const appendTranspiler = appendRuleTranspilers[targetAgent];
    if (appendTranspiler) {
      return appendTranspiler.transform(rule, targetAgent);
    }
  }

  const transpiler = ruleTranspilers[targetAgent];
  return transpiler.transform(rule, targetAgent);
}

/**
 * Transpile a canonical rule for all target agents.
 *
 * Returns an array of TranspiledOutputs — one per agent that can
 * receive the transpiled rule. Native passthrough items only produce
 * output for their matching agent.
 *
 * When `append` is true, uses append-mode transpilers for agents that
 * support it (Copilot, Claude Code). Other agents use per-rule files.
 */
export function transpileRuleForAllAgents(
  item: DiscoveredItem,
  agents: readonly TargetAgent[],
  append?: boolean
): TranspiledOutput[] {
  const outputs: TranspiledOutput[] = [];

  for (const agent of agents) {
    const output = transpileRule(item, agent, append);
    if (output !== null) {
      outputs.push(output);
    }
  }

  return outputs;
}
