import { describe, it, expect } from 'vitest';
import { parseInstructionContent } from './instruction-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function instructionmd(frontmatter: Record<string, unknown>, body = ''): string {
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
  name: 'coding-standards',
  description: 'Follow consistent coding standards across the project',
};

const MINIMAL_FRONTMATTER = {
  name: 'coding-standards',
  description: 'Follow consistent coding standards across the project',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parseInstructionContent — valid instructions', () => {
  it('parses a fully specified INSTRUCTIONS.md', () => {
    const content = instructionmd(VALID_FRONTMATTER, '## Standards\n\nUse consistent formatting.');
    const result = parseInstructionContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction).toEqual({
      name: 'coding-standards',
      description: 'Follow consistent coding standards across the project',
      schemaVersion: 1,
      body: '## Standards\n\nUse consistent formatting.',
    });
  });

  it('parses an INSTRUCTIONS.md with only required fields', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, 'Follow the rules.'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction).toEqual({
      name: 'coding-standards',
      description: 'Follow consistent coding standards across the project',
      schemaVersion: 1,
      body: 'Follow the rules.',
    });
  });

  it('defaults schema-version to 1 when omitted', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.schemaVersion).toBe(1);
  });

  it('accepts schema-version: 1 explicitly', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1 })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.schemaVersion).toBe(1);
  });

  it('accepts empty body', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.body).toBe('');
  });

  it('preserves body exactly (no transformation)', () => {
    const body = '## Section\n\n- Item 1\n- Item 2\n\n```ts\nconst x = 1;\n```';
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, body));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.body).toBe(body);
  });

  it('trims trailing whitespace from body', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, 'Body text  \n\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.body).toBe('Body text');
  });

  it('accepts single-word kebab-case name', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'standards' })
    );
    expect(result.ok).toBe(true);
  });

  it('accepts name with only numbers and hyphens', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'rule-1-2-3' })
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('parseInstructionContent — name validation', () => {
  it('rejects missing name', () => {
    const { name: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parseInstructionContent(instructionmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: name' });
  });

  it('rejects empty name', () => {
    const result = parseInstructionContent(instructionmd({ ...MINIMAL_FRONTMATTER, name: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name exceeding 128 characters', () => {
    const longName = 'a'.repeat(129);
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: longName })
    );
    expect(result).toEqual({ ok: false, error: 'name exceeds 128 characters' });
  });

  it('accepts name at exactly 128 characters', () => {
    const maxName = 'a'.repeat(128);
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: maxName })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects name not in kebab-case (uppercase)', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'Coding-Standards' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-instruction")',
    });
  });

  it('rejects name with underscores', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'coding_standards' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-instruction")',
    });
  });

  it('rejects name with spaces', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'coding standards' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-instruction")',
    });
  });

  it('rejects name with leading hyphen', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: '-coding-standards' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects name with trailing hyphen', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'coding-standards-' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects name with consecutive hyphens', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'coding--standards' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects numeric name (YAML parses bare numbers)', () => {
    const result = parseInstructionContent(instructionmd({ ...MINIMAL_FRONTMATTER, name: 123 }));
    expect(result).toEqual({ ok: false, error: 'name must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Description validation
// ---------------------------------------------------------------------------

describe('parseInstructionContent — description validation', () => {
  it('rejects missing description', () => {
    const { description: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parseInstructionContent(instructionmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: description' });
  });

  it('rejects description exceeding 512 characters', () => {
    const longDesc = 'x'.repeat(513);
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, description: longDesc })
    );
    expect(result).toEqual({ ok: false, error: 'description exceeds 512 characters' });
  });

  it('accepts description at exactly 512 characters', () => {
    const maxDesc = 'x'.repeat(512);
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, description: maxDesc })
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema version validation
// ---------------------------------------------------------------------------

describe('parseInstructionContent — schema-version validation', () => {
  it('rejects unsupported future schema-version', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 2 })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported schema-version 2');
    expect(result.error).toContain('upgrade dotai');
  });

  it('rejects schema-version 0', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 0 })
    );
    expect(result).toEqual({ ok: false, error: 'schema-version must be >= 1' });
  });

  it('rejects non-integer schema-version', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1.5 })
    );
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });

  it('rejects string schema-version', () => {
    const content = `---
name: coding-standards
description: Follow consistent coding standards
schema-version: "1"
---
`;
    const result = parseInstructionContent(content);
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });
});

// ---------------------------------------------------------------------------
// Unknown frontmatter key warnings
// ---------------------------------------------------------------------------

describe('parseInstructionContent — unknown field warnings', () => {
  it('warns on unknown frontmatter key', () => {
    const content = `---
name: coding-standards
description: Follow consistent coding standards
severity: error
---
`;
    const result = parseInstructionContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('severity');
  });

  it('warns on multiple unknown frontmatter keys', () => {
    const content = `---
name: coding-standards
description: Follow consistent coding standards
activation: always
globs: "*.ts"
---
`;
    const result = parseInstructionContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Malformed frontmatter
// ---------------------------------------------------------------------------

describe('parseInstructionContent — malformed input', () => {
  it('rejects malformed YAML frontmatter', () => {
    const content = `---
name: coding-standards
description: [invalid yaml
---
`;
    const result = parseInstructionContent(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid YAML frontmatter');
    }
  });
});
