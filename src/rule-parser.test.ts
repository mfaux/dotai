import { describe, it, expect } from 'vitest';
import { parseRuleContent } from './rule-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rulemd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const VALID_FRONTMATTER = {
  name: 'code-style',
  description: 'Enforce TypeScript code style conventions',
  globs: ['*.ts', '*.tsx'],
  activation: 'auto',
  severity: 'warning',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parseRuleContent — valid rules', () => {
  it('parses a fully specified RULES.md', () => {
    const content = rulemd(
      VALID_FRONTMATTER,
      '## TypeScript Code Style\n\nUse `const` over `let`.'
    );
    const result = parseRuleContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rule).toEqual({
      name: 'code-style',
      description: 'Enforce TypeScript code style conventions',
      globs: ['*.ts', '*.tsx'],
      activation: 'auto',
      severity: 'warning',
      schemaVersion: 1,
      body: '## TypeScript Code Style\n\nUse `const` over `let`.',
    });
  });

  it('defaults activation to "always" when omitted', () => {
    const { activation: _, ...fm } = VALID_FRONTMATTER;
    const result = parseRuleContent(rulemd(fm));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.activation).toBe('always');
  });

  it('defaults globs to empty array when omitted', () => {
    const { globs: _, ...fm } = VALID_FRONTMATTER;
    const result = parseRuleContent(rulemd(fm));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.globs).toEqual([]);
  });

  it('omits severity when not provided', () => {
    const { severity: _, ...fm } = VALID_FRONTMATTER;
    const result = parseRuleContent(rulemd(fm));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.severity).toBeUndefined();
  });

  it('defaults schema-version to 1 when omitted', () => {
    const result = parseRuleContent(rulemd(VALID_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.schemaVersion).toBe(1);
  });

  it('accepts schema-version: 1 explicitly', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, 'schema-version': 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.schemaVersion).toBe(1);
  });

  it('parses all four activation values', () => {
    for (const activation of ['always', 'auto', 'manual', 'glob'] as const) {
      const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, activation }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rule.activation).toBe(activation);
    }
  });

  it('accepts name with only numbers and hyphens', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'rule-1-2-3' }));
    expect(result.ok).toBe(true);
  });

  it('accepts single-word kebab-case name', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'style' }));
    expect(result.ok).toBe(true);
  });

  it('trims trailing whitespace from body', () => {
    const result = parseRuleContent(rulemd(VALID_FRONTMATTER, 'Body text  \n\n'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.body).toBe('Body text');
  });

  it('accepts empty body', () => {
    const result = parseRuleContent(rulemd(VALID_FRONTMATTER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule.body).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — name validation', () => {
  it('rejects missing name', () => {
    const { name: _, ...fm } = VALID_FRONTMATTER;
    const result = parseRuleContent(rulemd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: name' });
  });

  it('rejects empty name', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: '' }));
    // gray-matter parses `name:` with no value as empty string
    expect(result.ok).toBe(false);
  });

  it('rejects name with uppercase letters', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'Code-Style' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "code-style")',
    });
  });

  it('rejects name with underscores', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'code_style' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "code-style")',
    });
  });

  it('rejects name with spaces', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'code style' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "code-style")',
    });
  });

  it('rejects name with leading hyphen', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: '-code-style' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with trailing hyphen', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'code-style-' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with consecutive hyphens', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 'code--style' }));
    expect(result.ok).toBe(false);
  });

  it('rejects path traversal in name', () => {
    const result = parseRuleContent(
      rulemd({ ...VALID_FRONTMATTER, name: '../../../etc/cron.d/malicious' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects name exceeding 128 characters', () => {
    const longName = 'a'.repeat(129);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: longName }));
    expect(result).toEqual({ ok: false, error: 'name exceeds 128 characters' });
  });

  it('accepts name at exactly 128 characters', () => {
    // Build a valid 128-char kebab-case name: "a" repeated 128 times
    const maxName = 'a'.repeat(128);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: maxName }));
    expect(result.ok).toBe(true);
  });

  it('rejects numeric name (YAML parses bare numbers)', () => {
    // gray-matter will parse `name: 123` as a number
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, name: 123 }));
    expect(result).toEqual({ ok: false, error: 'name must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Description validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — description validation', () => {
  it('rejects missing description', () => {
    const { description: _, ...fm } = VALID_FRONTMATTER;
    const result = parseRuleContent(rulemd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: description' });
  });

  it('rejects description exceeding 512 characters', () => {
    const longDesc = 'x'.repeat(513);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, description: longDesc }));
    expect(result).toEqual({ ok: false, error: 'description exceeds 512 characters' });
  });

  it('accepts description at exactly 512 characters', () => {
    const maxDesc = 'x'.repeat(512);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, description: maxDesc }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Globs validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — globs validation', () => {
  it('rejects non-array globs (bare glob triggers YAML error)', () => {
    // `globs: *.ts` without quotes is invalid YAML — `*` is a YAML alias indicator.
    // gray-matter's js-yaml parser throws, which we surface as an error.
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, globs: '*.ts' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid YAML frontmatter');
    }
  });

  it('rejects non-array globs (quoted string)', () => {
    // A properly quoted string value for globs should be rejected as non-array.
    const content = `---
name: code-style
description: Enforce TypeScript code style conventions
globs: "src/**"
---
`;
    const result = parseRuleContent(content);
    expect(result).toEqual({ ok: false, error: 'globs must be an array of strings' });
  });

  it('rejects globs with non-string entries', () => {
    const content = `---
name: code-style
description: Enforce TypeScript code style conventions
globs:
  - 123
---
`;
    const result = parseRuleContent(content);
    expect(result).toEqual({ ok: false, error: 'globs[0] must be a string' });
  });

  it('rejects globs exceeding 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `*.ext${i}`);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, globs: tooMany }));
    expect(result).toEqual({ ok: false, error: 'globs exceeds 50 entries' });
  });

  it('accepts globs at exactly 50 entries', () => {
    const maxGlobs = Array.from({ length: 50 }, (_, i) => `*.ext${i}`);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, globs: maxGlobs }));
    expect(result.ok).toBe(true);
  });

  it('rejects individual glob exceeding 256 characters', () => {
    const longGlob = '*'.repeat(257);
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, globs: [longGlob] }));
    expect(result).toEqual({ ok: false, error: 'globs[0] exceeds 256 characters' });
  });
});

// ---------------------------------------------------------------------------
// Activation validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — activation validation', () => {
  it('rejects invalid activation value', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, activation: 'sometimes' }));
    expect(result).toEqual({
      ok: false,
      error: 'activation must be one of: always, auto, manual, glob',
    });
  });

  it('rejects non-string activation', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, activation: true }));
    expect(result).toEqual({ ok: false, error: 'activation must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Severity validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — severity validation', () => {
  it('rejects non-string severity', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, severity: 42 }));
    expect(result).toEqual({ ok: false, error: 'severity must be a string' });
  });

  it('accepts any string severity', () => {
    for (const severity of ['error', 'warning', 'info', 'custom-level']) {
      const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, severity }));
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema version validation
// ---------------------------------------------------------------------------

describe('parseRuleContent — schema-version validation', () => {
  it('rejects unsupported future schema-version', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, 'schema-version': 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported schema-version 2');
    expect(result.error).toContain('upgrade dotai');
  });

  it('rejects schema-version 0', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, 'schema-version': 0 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be >= 1' });
  });

  it('rejects non-integer schema-version', () => {
    const result = parseRuleContent(rulemd({ ...VALID_FRONTMATTER, 'schema-version': 1.5 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });

  it('rejects string schema-version', () => {
    const content = `---
name: code-style
description: Enforce TypeScript code style conventions
schema-version: "1"
---
`;
    const result = parseRuleContent(content);
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });
});
