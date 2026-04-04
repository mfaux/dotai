import { describe, it, expect } from 'vitest';
import { parsePromptContent } from './prompt-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PROMPT.md string with YAML frontmatter that supports nested objects.
 * Uses raw YAML string construction for agent override blocks.
 */
function promptYaml(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n\n${body}`;
}

const BASE_YAML = `name: review-code
description: Review code for bugs, performance, and style issues
tools:
  - Read
  - Grep`;

// ---------------------------------------------------------------------------
// Override extraction — happy paths
// ---------------------------------------------------------------------------

describe('parsePromptContent — per-agent overrides', () => {
  it('parses a prompt with a claude-code tools override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  tools:
    - Read
    - Write`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides).toBeDefined();
    expect(result.prompt.overrides!['claude-code']).toEqual({
      tools: ['Read', 'Write'],
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses a prompt with a github-copilot model override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses a prompt with multiple agent override blocks', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o
claude-code:
  tools:
    - Read
    - Write
    - Grep`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.prompt.overrides!['claude-code']).toEqual({
      tools: ['Read', 'Write', 'Grep'],
    });
  });

  it('parses override with description field', () => {
    const yaml = `${BASE_YAML}
cursor:
  description: Cursor-specific review prompt`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['cursor']).toEqual({
      description: 'Cursor-specific review prompt',
    });
  });

  it('parses override with argument-hint field', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  argument-hint: "<file-path>"`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      argumentHint: '<file-path>',
    });
  });

  it('parses override with agent field', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  agent: plan`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      agent: 'plan',
    });
  });

  it('parses override with multiple fields', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o
  description: Copilot-specific review
  agent: plan`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
      description: 'Copilot-specific review',
      agent: 'plan',
    });
  });
});

// ---------------------------------------------------------------------------
// No overrides — backward compatibility
// ---------------------------------------------------------------------------

describe('parsePromptContent — no overrides (backward compatible)', () => {
  it('returns undefined overrides when no override blocks present', () => {
    const result = parsePromptContent(promptYaml(BASE_YAML));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('returns warnings as empty array on success', () => {
    const result = parsePromptContent(promptYaml(BASE_YAML, 'Body text'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unknown agent key warnings
// ---------------------------------------------------------------------------

describe('parsePromptContent — unknown agent key warnings', () => {
  it('warns on unknown agent key', () => {
    const yaml = `${BASE_YAML}
fake-agent:
  model: gpt-4o`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fake-agent');
    expect(result.prompt.overrides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Non-overridable fields are ignored
// ---------------------------------------------------------------------------

describe('parsePromptContent — non-overridable fields', () => {
  it('ignores name in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  name: different-name
  model: gpt-4o`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.prompt.name).toBe('review-code');
  });

  it('ignores schema-version in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  schema-version: 2
  model: gpt-4o`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
  });

  it('ignores body in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  body: should be ignored
  model: gpt-4o`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
  });
});

// ---------------------------------------------------------------------------
// Override validation errors
// ---------------------------------------------------------------------------

describe('parsePromptContent — override validation', () => {
  it('warns on non-string model in override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: 42`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('model');
  });

  it('warns on non-array tools in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  tools: "Read"`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
    expect(result.warnings[0]).toContain('tools');
  });

  it('warns on non-object override block', () => {
    const yaml = `${BASE_YAML}
github-copilot: just-a-string`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('object');
  });

  it('accepts valid override blocks alongside invalid ones', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o
claude-code:
  model: 42`;
    const result = parsePromptContent(promptYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
  });
});
