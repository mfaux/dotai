import { describe, it, expect } from 'vitest';
import { parseRuleContent } from './rule-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a RULES.md string with YAML frontmatter that supports nested objects.
 * Uses raw YAML string construction for agent override blocks.
 */
function ruleYaml(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n\n${body}`;
}

const BASE_YAML = `name: code-style
description: Enforce TypeScript code style conventions
globs:
  - "*.ts"
  - "*.tsx"
activation: auto`;

// ---------------------------------------------------------------------------
// Override extraction — happy paths
// ---------------------------------------------------------------------------

describe('parseRuleContent — per-agent overrides', () => {
  it('parses a rule with a github-copilot activation override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  activation: always`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides).toBeDefined();
    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses a rule with a claude-code severity override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  severity: error`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['claude-code']).toEqual({
      severity: 'error',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses a rule with multiple agent override blocks', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  activation: always
claude-code:
  severity: error
cursor:
  activation: manual`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
    expect(result.rule.overrides!['claude-code']).toEqual({
      severity: 'error',
    });
    expect(result.rule.overrides!['cursor']).toEqual({
      activation: 'manual',
    });
  });

  it('parses override with description field', () => {
    const yaml = `${BASE_YAML}
windsurf:
  description: Windsurf-specific description`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['windsurf']).toEqual({
      description: 'Windsurf-specific description',
    });
  });

  it('parses override with globs field', () => {
    const yaml = `${BASE_YAML}
cline:
  globs:
    - "*.js"
    - "*.jsx"`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['cline']).toEqual({
      globs: ['*.js', '*.jsx'],
    });
  });

  it('parses override with multiple fields', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  activation: always
  description: Always apply for Copilot
  severity: error`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
      description: 'Always apply for Copilot',
      severity: 'error',
    });
  });
});

// ---------------------------------------------------------------------------
// No overrides — backward compatibility
// ---------------------------------------------------------------------------

describe('parseRuleContent — no overrides (backward compatible)', () => {
  it('returns undefined overrides when no override blocks present', () => {
    const result = parseRuleContent(ruleYaml(BASE_YAML));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('returns warnings as empty array on success', () => {
    const result = parseRuleContent(ruleYaml(BASE_YAML, 'Body text'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unknown agent key warnings
// ---------------------------------------------------------------------------

describe('parseRuleContent — unknown agent key warnings', () => {
  it('warns on unknown agent key', () => {
    const yaml = `${BASE_YAML}
fake-agent:
  activation: always`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fake-agent');
    expect(result.rule.overrides).toBeUndefined();
  });

  it('warns on multiple unknown agent keys', () => {
    const yaml = `${BASE_YAML}
not-an-agent:
  activation: always
also-not-an-agent:
  severity: info`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('not-an-agent');
    expect(result.warnings[1]).toContain('also-not-an-agent');
  });
});

// ---------------------------------------------------------------------------
// Non-overridable fields are ignored
// ---------------------------------------------------------------------------

describe('parseRuleContent — non-overridable fields', () => {
  it('ignores name in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  name: different-name
  activation: always`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // name should not appear in overrides; activation should
    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
    // Base name unchanged
    expect(result.rule.name).toBe('code-style');
  });

  it('ignores schema-version in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  schema-version: 2
  activation: always`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
  });

  it('ignores body in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  body: should be ignored
  activation: always`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
  });
});

// ---------------------------------------------------------------------------
// Override validation errors
// ---------------------------------------------------------------------------

describe('parseRuleContent — override validation', () => {
  it('warns on invalid activation value in override', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  activation: sometimes`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('activation');
    // Invalid override block should not be in overrides
    expect(result.rule.overrides).toBeUndefined();
  });

  it('warns on non-string severity in override', () => {
    const yaml = `${BASE_YAML}
claude-code:
  severity: 42`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
    expect(result.warnings[0]).toContain('severity');
  });

  it('warns on non-array globs in override', () => {
    const yaml = `${BASE_YAML}
cursor:
  globs: "*.ts"`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cursor');
    expect(result.warnings[0]).toContain('globs');
  });

  it('warns on non-object override block', () => {
    const yaml = `${BASE_YAML}
github-copilot: just-a-string`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('object');
  });

  it('accepts valid override blocks alongside invalid ones', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  activation: always
claude-code:
  severity: 42`;
    const result = parseRuleContent(ruleYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Valid override should be present
    expect(result.rule.overrides!['github-copilot']).toEqual({
      activation: 'always',
    });
    // Invalid override should produce a warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
  });
});
