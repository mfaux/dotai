import { describe, it, expect } from 'vitest';
import { parseAgentContent } from './agent-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an AGENT.md string with YAML frontmatter that supports nested objects.
 * Uses raw YAML string construction for agent override blocks.
 */
function agentYaml(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n\n${body}`;
}

const BASE_YAML = `name: architect
description: Senior architect for system design and code review
model: claude-sonnet-4
tools:
  - Read
  - Grep`;

// ---------------------------------------------------------------------------
// Override extraction — happy paths
// ---------------------------------------------------------------------------

describe('parseAgentContent — per-agent overrides', () => {
  it('parses an agent with a claude-code max-turns override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  max-turns: 5`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides).toBeDefined();
    expect(result.agent.overrides!['claude-code']).toEqual({
      maxTurns: 5,
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses an agent with a github-copilot model override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses an agent with claude-code-exclusive fields in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  disallowed-tools:
    - Edit
    - Write
  max-turns: 10
  background: true`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['claude-code']).toEqual({
      disallowedTools: ['Edit', 'Write'],
      maxTurns: 10,
      background: true,
    });
  });

  it('parses an agent with multiple agent override blocks', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: gpt-4o
claude-code:
  max-turns: 5
  background: true`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.agent.overrides!['claude-code']).toEqual({
      maxTurns: 5,
      background: true,
    });
  });

  it('parses override with description field', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific architect description`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific architect description',
    });
  });

  it('parses override with tools field', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  tools:
    - codebase_search
    - file_search`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      tools: ['codebase_search', 'file_search'],
    });
  });

  it('allows agent-exclusive fields in non-claude-code override blocks', () => {
    // Per spec: override validator accepts them in any block;
    // transpiler ignores unsupported fields
    const yaml = `${BASE_YAML}
github-copilot:
  max-turns: 10
  background: false`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      maxTurns: 10,
      background: false,
    });
  });
});

// ---------------------------------------------------------------------------
// No overrides — backward compatibility
// ---------------------------------------------------------------------------

describe('parseAgentContent — no overrides (backward compatible)', () => {
  it('returns undefined overrides when no override blocks present', () => {
    const result = parseAgentContent(agentYaml(BASE_YAML));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('returns warnings as empty array on success', () => {
    const result = parseAgentContent(agentYaml(BASE_YAML, 'System prompt'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unknown agent key warnings
// ---------------------------------------------------------------------------

describe('parseAgentContent — unknown agent key warnings', () => {
  it('warns on unknown agent key', () => {
    const yaml = `${BASE_YAML}
fake-agent:
  max-turns: 5`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fake-agent');
    expect(result.agent.overrides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Non-overridable fields are ignored
// ---------------------------------------------------------------------------

describe('parseAgentContent — non-overridable fields', () => {
  it('ignores name in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  name: different-name
  model: gpt-4o`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.agent.name).toBe('architect');
  });

  it('ignores body in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  body: should be ignored
  model: gpt-4o`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
  });

  it('ignores raw in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  raw: should be ignored
  model: gpt-4o`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
  });
});

// ---------------------------------------------------------------------------
// Override validation errors
// ---------------------------------------------------------------------------

describe('parseAgentContent — override validation', () => {
  it('warns on non-string model in override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  model: 42`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('model');
  });

  it('warns on invalid max-turns in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  max-turns: -5`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
    expect(result.warnings[0]).toContain('max-turns');
  });

  it('warns on non-boolean background in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  background: "yes"`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
    expect(result.warnings[0]).toContain('background');
  });

  it('warns on non-array disallowed-tools in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  disallowed-tools: "Edit"`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
    expect(result.warnings[0]).toContain('disallowed-tools');
  });

  it('warns on non-object override block', () => {
    const yaml = `${BASE_YAML}
github-copilot: just-a-string`;
    const result = parseAgentContent(agentYaml(yaml));

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
  max-turns: -5`;
    const result = parseAgentContent(agentYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent.overrides!['github-copilot']).toEqual({
      model: 'gpt-4o',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
  });
});
