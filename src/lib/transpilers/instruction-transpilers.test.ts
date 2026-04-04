import { describe, it, expect } from 'vitest';
import {
  copilotInstructionTranspiler,
  claudeCodeInstructionTranspiler,
  cursorInstructionTranspiler,
  opencodeInstructionTranspiler,
  instructionTranspilers,
  transpileInstruction,
  transpileInstructionForAllAgents,
} from './instruction-transpilers.ts';
import { TARGET_AGENTS } from '../agents/index.ts';
import type { CanonicalInstruction, DiscoveredItem, TargetAgent } from '../../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstruction(overrides: Partial<CanonicalInstruction> = {}): CanonicalInstruction {
  return {
    name: 'code-style',
    description: 'Enforce consistent code style across the project',
    schemaVersion: 1,
    body: 'Use 2-space indentation.\n\nPrefer const over let.',
    ...overrides,
  };
}

function makeDiscoveredInstructionItem(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
  return {
    type: 'instruction',
    format: 'canonical',
    name: 'code-style',
    description: 'Enforce consistent code style across the project',
    sourcePath: '/repo/instructions/code-style/INSTRUCTIONS.md',
    rawContent: [
      '---',
      'name: code-style',
      'description: Enforce consistent code style across the project',
      '---',
      '',
      'Use 2-space indentation.',
      '',
      'Prefer const over let.',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canTranspile
// ---------------------------------------------------------------------------

describe('canTranspile', () => {
  const canonicalInstruction = makeDiscoveredInstructionItem();
  const nativeItem = makeDiscoveredInstructionItem({
    format: 'native:github-copilot',
  });
  const skillItem = makeDiscoveredInstructionItem({ type: 'skill' });
  const ruleItem = makeDiscoveredInstructionItem({ type: 'prompt' });
  const promptItem = makeDiscoveredInstructionItem({ type: 'prompt' });

  const transpilers = [
    ['copilot', copilotInstructionTranspiler],
    ['claude-code', claudeCodeInstructionTranspiler],
    ['cursor', cursorInstructionTranspiler],
    ['opencode', opencodeInstructionTranspiler],
  ] as const;

  it.each(transpilers)('%s accepts canonical instructions', (_name, transpiler) => {
    expect(transpiler.canTranspile(canonicalInstruction)).toBe(true);
  });

  it.each(transpilers)('%s rejects native items', (_name, transpiler) => {
    expect(transpiler.canTranspile(nativeItem)).toBe(false);
  });

  it.each(transpilers)('%s rejects skill items', (_name, transpiler) => {
    expect(transpiler.canTranspile(skillItem)).toBe(false);
  });

  it.each(transpilers)('%s rejects rule items', (_name, transpiler) => {
    expect(transpiler.canTranspile(ruleItem)).toBe(false);
  });

  it.each(transpilers)('%s rejects prompt items', (_name, transpiler) => {
    expect(transpiler.canTranspile(promptItem)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copilot instruction transpiler
// ---------------------------------------------------------------------------

describe('Copilot instruction transpiler', () => {
  it('targets .github/copilot-instructions.md in append mode', () => {
    const instruction = makeInstruction();
    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');

    expect(output.filename).toBe('copilot-instructions.md');
    expect(output.outputDir).toBe('.github');
    expect(output.mode).toBe('append');
  });

  it('includes heading and description blockquote', () => {
    const instruction = makeInstruction();
    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');

    expect(output.content).toContain('## code-style');
    expect(output.content).toContain('> Enforce consistent code style across the project');
  });

  it('includes body content', () => {
    const instruction = makeInstruction();
    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');

    expect(output.content).toContain('Use 2-space indentation.');
    expect(output.content).toContain('Prefer const over let.');
  });
});

// ---------------------------------------------------------------------------
// Claude Code instruction transpiler
// ---------------------------------------------------------------------------

describe('Claude Code instruction transpiler', () => {
  it('targets CLAUDE.md in append mode', () => {
    const instruction = makeInstruction();
    const output = claudeCodeInstructionTranspiler.transform(instruction, 'claude-code');

    expect(output.filename).toBe('CLAUDE.md');
    expect(output.outputDir).toBe('.');
    expect(output.mode).toBe('append');
  });

  it('includes heading and description blockquote', () => {
    const instruction = makeInstruction();
    const output = claudeCodeInstructionTranspiler.transform(instruction, 'claude-code');

    expect(output.content).toContain('## code-style');
    expect(output.content).toContain('> Enforce consistent code style across the project');
  });

  it('includes body content', () => {
    const instruction = makeInstruction();
    const output = claudeCodeInstructionTranspiler.transform(instruction, 'claude-code');

    expect(output.content).toContain('Use 2-space indentation.');
    expect(output.content).toContain('Prefer const over let.');
  });
});

// ---------------------------------------------------------------------------
// Cursor instruction transpiler
// ---------------------------------------------------------------------------

describe('Cursor instruction transpiler', () => {
  it('targets AGENTS.md in append mode', () => {
    const instruction = makeInstruction();
    const output = cursorInstructionTranspiler.transform(instruction, 'cursor');

    expect(output.filename).toBe('AGENTS.md');
    expect(output.outputDir).toBe('.');
    expect(output.mode).toBe('append');
  });

  it('includes heading and description blockquote', () => {
    const instruction = makeInstruction();
    const output = cursorInstructionTranspiler.transform(instruction, 'cursor');

    expect(output.content).toContain('## code-style');
    expect(output.content).toContain('> Enforce consistent code style across the project');
  });
});

// ---------------------------------------------------------------------------
// OpenCode instruction transpiler
// ---------------------------------------------------------------------------

describe('OpenCode instruction transpiler', () => {
  it('targets AGENTS.md in append mode', () => {
    const instruction = makeInstruction();
    const output = opencodeInstructionTranspiler.transform(instruction, 'opencode');

    expect(output.filename).toBe('AGENTS.md');
    expect(output.outputDir).toBe('.');
    expect(output.mode).toBe('append');
  });

  it('includes heading and description blockquote', () => {
    const instruction = makeInstruction();
    const output = opencodeInstructionTranspiler.transform(instruction, 'opencode');

    expect(output.content).toContain('## code-style');
    expect(output.content).toContain('> Enforce consistent code style across the project');
  });
});

// ---------------------------------------------------------------------------
// transpileInstruction (integrated)
// ---------------------------------------------------------------------------

describe('transpileInstruction', () => {
  it('transpiles canonical instruction for copilot', () => {
    const item = makeDiscoveredInstructionItem();
    const output = transpileInstruction(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('copilot-instructions.md');
    expect(output!.outputDir).toBe('.github');
    expect(output!.mode).toBe('append');
    expect(output!.content).toContain('## code-style');
  });

  it('transpiles canonical instruction for claude-code', () => {
    const item = makeDiscoveredInstructionItem();
    const output = transpileInstruction(item, 'claude-code');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('CLAUDE.md');
    expect(output!.outputDir).toBe('.');
    expect(output!.mode).toBe('append');
  });

  it('transpiles canonical instruction for cursor', () => {
    const item = makeDiscoveredInstructionItem();
    const output = transpileInstruction(item, 'cursor');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('AGENTS.md');
    expect(output!.outputDir).toBe('.');
    expect(output!.mode).toBe('append');
  });

  it('transpiles canonical instruction for opencode', () => {
    const item = makeDiscoveredInstructionItem();
    const output = transpileInstruction(item, 'opencode');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('AGENTS.md');
    expect(output!.outputDir).toBe('.');
    expect(output!.mode).toBe('append');
  });

  it('returns null for invalid canonical content', () => {
    const item = makeDiscoveredInstructionItem({
      rawContent: '---\n---\n\nNo frontmatter fields',
    });

    const output = transpileInstruction(item, 'github-copilot');
    expect(output).toBeNull();
  });

  it('applies per-agent description override', () => {
    const item = makeDiscoveredInstructionItem({
      rawContent: [
        '---',
        'name: code-style',
        'description: Default description',
        'github-copilot:',
        '  description: Copilot-specific description',
        '---',
        '',
        'Body content.',
      ].join('\n'),
    });

    const copilotOutput = transpileInstruction(item, 'github-copilot');
    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).toContain('> Copilot-specific description');
    expect(copilotOutput!.content).not.toContain('> Default description');

    // Other agents get the default description
    const claudeOutput = transpileInstruction(item, 'claude-code');
    expect(claudeOutput).not.toBeNull();
    expect(claudeOutput!.content).toContain('> Default description');
  });
});

// ---------------------------------------------------------------------------
// transpileInstructionForAllAgents
// ---------------------------------------------------------------------------

describe('transpileInstructionForAllAgents', () => {
  it('produces outputs for all agents from canonical instruction', () => {
    const item = makeDiscoveredInstructionItem();
    const outputs = transpileInstructionForAllAgents(item, TARGET_AGENTS);

    // 4 agents but Cursor + OpenCode share AGENTS.md → 3 unique outputs
    expect(outputs).toHaveLength(3);

    const filenames = outputs.map((o) => `${o.outputDir}/${o.filename}`).sort();
    expect(filenames).toEqual(['./AGENTS.md', './CLAUDE.md', '.github/copilot-instructions.md']);
  });

  it('all outputs use append mode', () => {
    const item = makeDiscoveredInstructionItem();
    const outputs = transpileInstructionForAllAgents(item, TARGET_AGENTS);

    for (const output of outputs) {
      expect(output.mode).toBe('append');
    }
  });

  it('deduplicates AGENTS.md for Cursor and OpenCode', () => {
    const item = makeDiscoveredInstructionItem();
    const agents: TargetAgent[] = ['cursor', 'opencode'];

    const outputs = transpileInstructionForAllAgents(item, agents);

    // Should produce exactly one output, not two
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.filename).toBe('AGENTS.md');
    expect(outputs[0]!.outputDir).toBe('.');
  });

  it('handles subset of target agents', () => {
    const item = makeDiscoveredInstructionItem();
    const agents: TargetAgent[] = ['github-copilot'];

    const outputs = transpileInstructionForAllAgents(item, agents);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.filename).toBe('copilot-instructions.md');
  });

  it('returns empty array for invalid content', () => {
    const item = makeDiscoveredInstructionItem({
      rawContent: 'not valid frontmatter content',
    });

    const outputs = transpileInstructionForAllAgents(item, TARGET_AGENTS);
    expect(outputs).toHaveLength(0);
  });

  it('returns empty array for empty agent list', () => {
    const item = makeDiscoveredInstructionItem();
    const outputs = transpileInstructionForAllAgents(item, []);

    expect(outputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

describe('instructionTranspilers registry', () => {
  it('has entries for all four target agents', () => {
    expect(Object.keys(instructionTranspilers).sort()).toEqual([
      'claude-code',
      'cursor',
      'github-copilot',
      'opencode',
    ]);
  });

  it('all entries implement canTranspile and transform', () => {
    for (const [, transpiler] of Object.entries(instructionTranspilers)) {
      expect(typeof transpiler.canTranspile).toBe('function');
      expect(typeof transpiler.transform).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles instruction with empty body', () => {
    const instruction = makeInstruction({ body: '' });

    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');
    expect(output.content).toContain('## code-style');
    expect(output.content).toContain('>');
  });

  it('handles instruction with very long body', () => {
    const body = 'x'.repeat(10000);
    const instruction = makeInstruction({ body });

    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');
    expect(output.content).toContain(body);
  });

  it('preserves markdown formatting in body', () => {
    const body = [
      '## Style Rules',
      '',
      '- Use 2-space indentation',
      '- Prefer const over let',
      '',
      '```typescript',
      'const x = 1;',
      '```',
    ].join('\n');
    const instruction = makeInstruction({ body });

    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');
    expect(output.content).toContain('## Style Rules');
    expect(output.content).toContain('```typescript');
  });

  it('handles instruction name with numbers', () => {
    const instruction = makeInstruction({ name: 'style-v2' });

    const output = copilotInstructionTranspiler.transform(instruction, 'github-copilot');
    expect(output.content).toContain('## style-v2');
  });
});
