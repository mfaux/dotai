import { describe, it, expect } from 'vitest';
import { parsePromptContent } from './prompt-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function promptmd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const VALID_FRONTMATTER = {
  name: 'review-code',
  description: 'Review code for bugs, performance, and style issues',
  'argument-hint': '<file-or-directory>',
  agent: 'plan',
  model: 'claude-sonnet-4',
  tools: ['Read', 'Grep'],
};

const MINIMAL_FRONTMATTER = {
  name: 'review-code',
  description: 'Review code for bugs, performance, and style issues',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parsePromptContent — valid prompts', () => {
  it('parses a fully specified PROMPT.md', () => {
    const content = promptmd(
      VALID_FRONTMATTER,
      '## Review\n\nCheck for bugs and performance issues.'
    );
    const result = parsePromptContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt).toEqual({
      name: 'review-code',
      description: 'Review code for bugs, performance, and style issues',
      argumentHint: '<file-or-directory>',
      agent: 'plan',
      model: 'claude-sonnet-4',
      tools: ['Read', 'Grep'],
      schemaVersion: 1,
      body: '## Review\n\nCheck for bugs and performance issues.',
    });
  });

  it('parses a PROMPT.md with only required fields', () => {
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER, 'Do the review.'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.prompt).toEqual({
      name: 'review-code',
      description: 'Review code for bugs, performance, and style issues',
      tools: [],
      schemaVersion: 1,
      body: 'Do the review.',
    });
    expect(result.prompt.argumentHint).toBeUndefined();
    expect(result.prompt.agent).toBeUndefined();
    expect(result.prompt.model).toBeUndefined();
  });

  it('defaults tools to empty array when omitted', () => {
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.tools).toEqual([]);
  });

  it('defaults schema-version to 1 when omitted', () => {
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.schemaVersion).toBe(1);
  });

  it('accepts schema-version: 1 explicitly', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.schemaVersion).toBe(1);
  });

  it('accepts empty body', () => {
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.body).toBe('');
  });

  it('preserves body exactly (no transformation)', () => {
    const body =
      'Review @$1 for:\n\n1. Bugs\n2. Performance\n\n!`git diff --cached`\n\nUse $ARGUMENTS for criteria.';
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER, body));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.body).toBe(body);
  });

  it('preserves model field as-is (no resolution at parse time)', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, model: 'gpt-4o-mini' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.model).toBe('gpt-4o-mini');
  });

  it('trims trailing whitespace from body', () => {
    const result = parsePromptContent(promptmd(MINIMAL_FRONTMATTER, 'Body text  \n\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompt.body).toBe('Body text');
  });

  it('accepts single-word kebab-case name', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'review' }));
    expect(result.ok).toBe(true);
  });

  it('accepts name with only numbers and hyphens', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'prompt-1-2-3' }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — name validation', () => {
  it('rejects missing name', () => {
    const { name: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parsePromptContent(promptmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: name' });
  });

  it('rejects empty name', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name exceeding 128 characters', () => {
    const longName = 'a'.repeat(129);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: longName }));
    expect(result).toEqual({ ok: false, error: 'name exceeds 128 characters' });
  });

  it('accepts name at exactly 128 characters', () => {
    const maxName = 'a'.repeat(128);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: maxName }));
    expect(result.ok).toBe(true);
  });

  it('rejects name not in kebab-case (uppercase)', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'Review-Code' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "review-code")',
    });
  });

  it('rejects name with underscores', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'review_code' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "review-code")',
    });
  });

  it('rejects name with spaces', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'review code' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "review-code")',
    });
  });

  it('rejects name with leading hyphen', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: '-review-code' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with trailing hyphen', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'review-code-' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with consecutive hyphens', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 'review--code' }));
    expect(result.ok).toBe(false);
  });

  it('rejects numeric name (YAML parses bare numbers)', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, name: 123 }));
    expect(result).toEqual({ ok: false, error: 'name must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Description validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — description validation', () => {
  it('rejects missing description', () => {
    const { description: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parsePromptContent(promptmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: description' });
  });

  it('rejects description exceeding 512 characters', () => {
    const longDesc = 'x'.repeat(513);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, description: longDesc }));
    expect(result).toEqual({ ok: false, error: 'description exceeds 512 characters' });
  });

  it('accepts description at exactly 512 characters', () => {
    const maxDesc = 'x'.repeat(512);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, description: maxDesc }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Argument-hint validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — argument-hint validation', () => {
  it('rejects argument-hint exceeding 256 characters', () => {
    const longHint = 'x'.repeat(257);
    const result = parsePromptContent(
      promptmd({ ...MINIMAL_FRONTMATTER, 'argument-hint': longHint })
    );
    expect(result).toEqual({
      ok: false,
      error: 'argument-hint exceeds 256 characters',
    });
  });

  it('accepts argument-hint at exactly 256 characters', () => {
    const maxHint = 'x'.repeat(256);
    const result = parsePromptContent(
      promptmd({ ...MINIMAL_FRONTMATTER, 'argument-hint': maxHint })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects non-string argument-hint', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, 'argument-hint': 42 }));
    expect(result).toEqual({ ok: false, error: 'argument-hint must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Agent validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — agent validation', () => {
  it('rejects non-string agent', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, agent: true }));
    expect(result).toEqual({ ok: false, error: 'agent must be a string' });
  });

  it('rejects agent exceeding 128 characters', () => {
    const longAgent = 'x'.repeat(129);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, agent: longAgent }));
    expect(result).toEqual({ ok: false, error: 'agent exceeds 128 characters' });
  });

  it('accepts any string agent value', () => {
    for (const agent of ['plan', 'code', 'ask', 'custom-agent']) {
      const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, agent }));
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — model validation', () => {
  it('rejects non-string model', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, model: 42 }));
    expect(result).toEqual({ ok: false, error: 'model must be a string' });
  });

  it('rejects model exceeding 128 characters', () => {
    const longModel = 'x'.repeat(129);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, model: longModel }));
    expect(result).toEqual({ ok: false, error: 'model exceeds 128 characters' });
  });

  it('accepts any string model value', () => {
    for (const model of ['claude-sonnet-4', 'gpt-4o', 'gemini-2.0-flash']) {
      const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, model }));
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tools validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — tools validation', () => {
  it('rejects non-array tools', () => {
    const content = `---
name: review-code
description: Review code for bugs
tools: "Read"
---
`;
    const result = parsePromptContent(content);
    expect(result).toEqual({ ok: false, error: 'tools must be an array of strings' });
  });

  it('rejects tools with non-string entries', () => {
    const content = `---
name: review-code
description: Review code for bugs
tools:
  - 123
---
`;
    const result = parsePromptContent(content);
    expect(result).toEqual({ ok: false, error: 'tools[0] must be a string' });
  });

  it('rejects tools exceeding 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, tools: tooMany }));
    expect(result).toEqual({ ok: false, error: 'tools exceeds 50 entries' });
  });

  it('accepts tools at exactly 50 entries', () => {
    const maxTools = Array.from({ length: 50 }, (_, i) => `Tool${i}`);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, tools: maxTools }));
    expect(result.ok).toBe(true);
  });

  it('rejects individual tool name exceeding 128 characters', () => {
    const longTool = 'T'.repeat(129);
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, tools: [longTool] }));
    expect(result).toEqual({ ok: false, error: 'tools[0] exceeds 128 characters' });
  });
});

// ---------------------------------------------------------------------------
// Schema version validation
// ---------------------------------------------------------------------------

describe('parsePromptContent — schema-version validation', () => {
  it('rejects unsupported future schema-version', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported schema-version 2');
    expect(result.error).toContain('upgrade dotai');
  });

  it('rejects schema-version 0', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 0 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be >= 1' });
  });

  it('rejects non-integer schema-version', () => {
    const result = parsePromptContent(promptmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1.5 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });

  it('rejects string schema-version', () => {
    const content = `---
name: review-code
description: Review code for bugs
schema-version: "1"
---
`;
    const result = parsePromptContent(content);
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });
});

// ---------------------------------------------------------------------------
// Malformed frontmatter
// ---------------------------------------------------------------------------

describe('parsePromptContent — malformed input', () => {
  it('rejects malformed YAML frontmatter', () => {
    const content = `---
name: review-code
description: [invalid yaml
---
`;
    const result = parsePromptContent(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid YAML frontmatter');
    }
  });
});
