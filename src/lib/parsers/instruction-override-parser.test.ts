import { describe, it, expect } from 'vitest';
import { parseInstructionContent } from './instruction-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an INSTRUCTIONS.md string with YAML frontmatter that supports nested
 * objects. Uses raw YAML string construction for agent override blocks.
 */
function instructionYaml(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n\n${body}`;
}

const BASE_YAML = `name: coding-standards
description: Follow consistent coding standards across the project`;

// ---------------------------------------------------------------------------
// Override extraction — happy paths
// ---------------------------------------------------------------------------

describe('parseInstructionContent — per-agent overrides', () => {
  it('parses an instruction with a github-copilot description override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific coding standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides).toBeDefined();
    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific coding standards',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses an instruction with a claude-code description override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  description: Claude-specific coding standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['claude-code']).toEqual({
      description: 'Claude-specific coding standards',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses an instruction with multiple agent override blocks', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific standards
claude-code:
  description: Claude-specific standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific standards',
    });
    expect(result.instruction.overrides!['claude-code']).toEqual({
      description: 'Claude-specific standards',
    });
  });

  it('parses an instruction with cursor description override', () => {
    const yaml = `${BASE_YAML}
cursor:
  description: Cursor-specific coding standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['cursor']).toEqual({
      description: 'Cursor-specific coding standards',
    });
  });

  it('parses an instruction with opencode description override', () => {
    const yaml = `${BASE_YAML}
opencode:
  description: OpenCode-specific coding standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['opencode']).toEqual({
      description: 'OpenCode-specific coding standards',
    });
  });
});

// ---------------------------------------------------------------------------
// No overrides — backward compatibility
// ---------------------------------------------------------------------------

describe('parseInstructionContent — no overrides (backward compatible)', () => {
  it('returns undefined overrides when no override blocks present', () => {
    const result = parseInstructionContent(instructionYaml(BASE_YAML));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('returns warnings as empty array on success', () => {
    const result = parseInstructionContent(instructionYaml(BASE_YAML, 'Body text'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unknown agent key warnings
// ---------------------------------------------------------------------------

describe('parseInstructionContent — unknown agent key warnings', () => {
  it('warns on unknown agent key', () => {
    const yaml = `${BASE_YAML}
fake-agent:
  description: Unknown agent`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fake-agent');
    expect(result.instruction.overrides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Non-overridable fields are ignored
// ---------------------------------------------------------------------------

describe('parseInstructionContent — non-overridable fields', () => {
  it('ignores name in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  name: different-name
  description: Copilot-specific standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific standards',
    });
    expect(result.instruction.name).toBe('coding-standards');
  });

  it('ignores schema-version in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  schema-version: 2
  description: Copilot-specific standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific standards',
    });
  });

  it('ignores body in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  body: should be ignored
  description: Copilot-specific standards`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific standards',
    });
  });
});

// ---------------------------------------------------------------------------
// Override validation errors
// ---------------------------------------------------------------------------

describe('parseInstructionContent — override validation', () => {
  it('warns on non-string description in override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: 42`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('description');
  });

  it('warns on non-object override block', () => {
    const yaml = `${BASE_YAML}
github-copilot: just-a-string`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('object');
  });

  it('accepts valid override blocks alongside invalid ones', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific standards
claude-code:
  description: 42`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific standards',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
  });
});
