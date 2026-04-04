import type { Transpiler } from './transpiler.ts';
import type {
  CanonicalInstruction,
  DiscoveredItem,
  TargetAgent,
  TranspiledOutput,
} from '../types.ts';
import { parseInstructionContent } from '../parsers/index.ts';
import { getTargetAgentConfig } from '../agents/index.ts';
import { mergeOverrides } from '../parsers/index.ts';

// ---------------------------------------------------------------------------
// Instruction transpilers — canonical INSTRUCTIONS.md → per-agent output
//
// Each transpiler converts a CanonicalInstruction into a marker-based append
// section for the target agent's project-wide instruction file (e.g.,
// AGENTS.md, CLAUDE.md, .github/copilot-instructions.md).
//
// All transpilers use `mode: 'append'` with `<!-- dotai:<name>:start/end -->`
// markers. The installer uses `upsertSection()` to insert or update the
// content between markers without disturbing hand-written content.
//
// Reference: prd-instruction-transpilers.md
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared content builder
//
// All instruction transpilers produce the same markdown structure:
//   ## <name>
//   > <description>
//   <body>
//
// This mirrors the standard append transpiler pattern.
// ---------------------------------------------------------------------------

function buildInstructionContent(instruction: CanonicalInstruction): string {
  const lines: string[] = [];

  lines.push(`## ${instruction.name}`);
  lines.push('');
  lines.push(`> ${instruction.description}`);
  lines.push('');
  lines.push(instruction.body);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// GitHub Copilot instruction transpiler (→ .github/copilot-instructions.md)
// ---------------------------------------------------------------------------

export const copilotInstructionTranspiler: Transpiler<CanonicalInstruction> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'instruction' && item.format === 'canonical';
  },

  transform(instruction: CanonicalInstruction, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('github-copilot');

    return {
      filename: config.instructionsConfig.filename,
      content: buildInstructionContent(instruction),
      outputDir: config.instructionsConfig.outputDir,
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code instruction transpiler (→ CLAUDE.md)
// ---------------------------------------------------------------------------

export const claudeCodeInstructionTranspiler: Transpiler<CanonicalInstruction> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'instruction' && item.format === 'canonical';
  },

  transform(instruction: CanonicalInstruction, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('claude-code');

    return {
      filename: config.instructionsConfig.filename,
      content: buildInstructionContent(instruction),
      outputDir: config.instructionsConfig.outputDir,
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// Cursor instruction transpiler (→ AGENTS.md)
// ---------------------------------------------------------------------------

export const cursorInstructionTranspiler: Transpiler<CanonicalInstruction> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'instruction' && item.format === 'canonical';
  },

  transform(instruction: CanonicalInstruction, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('cursor');

    return {
      filename: config.instructionsConfig.filename,
      content: buildInstructionContent(instruction),
      outputDir: config.instructionsConfig.outputDir,
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// OpenCode instruction transpiler (→ AGENTS.md)
// ---------------------------------------------------------------------------

export const opencodeInstructionTranspiler: Transpiler<CanonicalInstruction> = {
  canTranspile(item: DiscoveredItem): boolean {
    return item.type === 'instruction' && item.format === 'canonical';
  },

  transform(instruction: CanonicalInstruction, _targetAgent: TargetAgent): TranspiledOutput {
    const config = getTargetAgentConfig('opencode');

    return {
      filename: config.instructionsConfig.filename,
      content: buildInstructionContent(instruction),
      outputDir: config.instructionsConfig.outputDir,
      mode: 'append',
    };
  },
};

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

/** Map of target agents to their instruction transpilers. */
export const instructionTranspilers: Record<TargetAgent, Transpiler<CanonicalInstruction>> = {
  'github-copilot': copilotInstructionTranspiler,
  'claude-code': claudeCodeInstructionTranspiler,
  cursor: cursorInstructionTranspiler,
  opencode: opencodeInstructionTranspiler,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transpile a canonical instruction for a specific target agent.
 *
 * Parses the raw content to extract the CanonicalInstruction, merges
 * per-agent overrides, then delegates to the appropriate transpiler.
 * Returns `null` if parsing fails.
 */
export function transpileInstruction(
  item: DiscoveredItem,
  targetAgent: TargetAgent
): TranspiledOutput | null {
  const transpiler = instructionTranspilers[targetAgent];

  const parsed = parseInstructionContent(item.rawContent);
  if (!parsed.ok) {
    return null;
  }

  // Merge per-agent overrides on top of base fields
  const instruction = mergeOverrides(parsed.instruction, targetAgent) as CanonicalInstruction;

  return transpiler.transform(instruction, targetAgent);
}

/**
 * Resolve the output path key for a target agent's instruction config.
 * Used for deduplication: agents sharing the same key target the same file.
 */
function outputPathKey(agent: TargetAgent): string {
  const config = getTargetAgentConfig(agent);
  const { outputDir, filename } = config.instructionsConfig;
  return `${outputDir}/${filename}`;
}

/**
 * Transpile a canonical instruction for all target agents, with
 * output-path deduplication.
 *
 * When multiple agents target the same output file (e.g., Cursor and
 * OpenCode both target `AGENTS.md`), the instruction content is emitted
 * only once. Per-agent description overrides are still applied: the first
 * agent in the list whose override differs gets its version emitted, and
 * subsequent agents sharing the same path are skipped.
 *
 * Returns an array of TranspiledOutputs, one per unique output path.
 */
export function transpileInstructionForAllAgents(
  item: DiscoveredItem,
  agents: readonly TargetAgent[]
): TranspiledOutput[] {
  const seen = new Set<string>();
  const outputs: TranspiledOutput[] = [];

  for (const agent of agents) {
    const key = outputPathKey(agent);
    if (seen.has(key)) {
      continue; // Deduplicate: skip agents sharing the same output file
    }
    seen.add(key);

    const output = transpileInstruction(item, agent);
    if (output !== null) {
      outputs.push(output);
    }
  }

  return outputs;
}
