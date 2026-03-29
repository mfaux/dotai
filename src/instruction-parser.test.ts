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

/**
 * Build an INSTRUCTIONS.md string with raw YAML (for override blocks).
 */
function instructionYaml(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n\n${body}`;
}

const VALID_FRONTMATTER = {
  name: 'setup-guide',
  description: 'Step-by-step setup instructions for the project',
};

const MINIMAL_FRONTMATTER = {
  name: 'setup-guide',
  description: 'Step-by-step setup instructions for the project',
};

const BASE_YAML = `name: setup-guide
description: Step-by-step setup instructions for the project`;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parseInstructionContent — valid instructions', () => {
  it('parses an INSTRUCTIONS.md with name, description, and body', () => {
    const content = instructionmd(
      VALID_FRONTMATTER,
      '## Getting Started\n\nFollow these steps to set up.'
    );
    const result = parseInstructionContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction).toEqual({
      name: 'setup-guide',
      description: 'Step-by-step setup instructions for the project',
      schemaVersion: 1,
      body: '## Getting Started\n\nFollow these steps to set up.',
    });
  });

  it('parses an INSTRUCTIONS.md with only required fields', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, 'Do the setup.'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction).toEqual({
      name: 'setup-guide',
      description: 'Step-by-step setup instructions for the project',
      schemaVersion: 1,
      body: 'Do the setup.',
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

  it('trims trailing whitespace from body', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, 'Body text  \n\n'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.body).toBe('Body text');
  });

  it('preserves body exactly (no transformation)', () => {
    const body =
      '# Setup\n\n1. Install dependencies\n2. Configure env\n\n```bash\npnpm install\n```';
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER, body));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instruction.body).toBe(body);
  });

  it('accepts single-word kebab-case name', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'setup' })
    );
    expect(result.ok).toBe(true);
  });

  it('accepts name with only numbers and hyphens', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'guide-1-2-3' })
    );
    expect(result.ok).toBe(true);
  });

  it('returns empty warnings on success with no overrides', () => {
    const result = parseInstructionContent(instructionmd(MINIMAL_FRONTMATTER));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
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
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'Setup-Guide' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "setup-guide")',
    });
  });

  it('rejects name with underscores', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'setup_guide' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "setup-guide")',
    });
  });

  it('rejects name with spaces', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'setup guide' })
    );
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "setup-guide")',
    });
  });

  it('rejects name with leading hyphen', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: '-setup-guide' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects name with trailing hyphen', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'setup-guide-' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects name with consecutive hyphens', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, name: 'setup--guide' })
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
    expect(result).toEqual({
      ok: false,
      error: 'missing required field: description',
    });
  });

  it('rejects description exceeding 512 characters', () => {
    const longDesc = 'x'.repeat(513);
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, description: longDesc })
    );
    expect(result).toEqual({
      ok: false,
      error: 'description exceeds 512 characters',
    });
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
    expect(result).toEqual({
      ok: false,
      error: 'schema-version must be >= 1',
    });
  });

  it('rejects non-integer schema-version', () => {
    const result = parseInstructionContent(
      instructionmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1.5 })
    );
    expect(result).toEqual({
      ok: false,
      error: 'schema-version must be an integer',
    });
  });

  it('rejects string schema-version', () => {
    const content = `---
name: setup-guide
description: Step-by-step setup instructions
schema-version: "1"
---
`;
    const result = parseInstructionContent(content);
    expect(result).toEqual({
      ok: false,
      error: 'schema-version must be an integer',
    });
  });
});

// ---------------------------------------------------------------------------
// Per-agent description overrides
// ---------------------------------------------------------------------------

describe('parseInstructionContent — per-agent overrides', () => {
  it('parses an instruction with a description override', () => {
    const yaml = `${BASE_YAML}
cursor:
  description: Cursor-specific setup instructions`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides).toBeDefined();
    expect(result.instruction.overrides!['cursor']).toEqual({
      description: 'Cursor-specific setup instructions',
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses multiple agent description overrides', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific setup
claude-code:
  description: Claude-specific setup`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific setup',
    });
    expect(result.instruction.overrides!['claude-code']).toEqual({
      description: 'Claude-specific setup',
    });
  });

  it('returns undefined overrides when no override blocks present', () => {
    const result = parseInstructionContent(instructionYaml(BASE_YAML));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unknown field warnings
// ---------------------------------------------------------------------------

describe('parseInstructionContent — unknown field warnings', () => {
  it('warns on unknown frontmatter key', () => {
    const yaml = `${BASE_YAML}
fake-agent:
  description: Something`;
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
  description: Copilot-specific`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific',
    });
    expect(result.instruction.name).toBe('setup-guide');
  });

  it('ignores schema-version in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  schema-version: 2
  description: Copilot-specific`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific',
    });
  });

  it('ignores body in override block', () => {
    const yaml = `${BASE_YAML}
github-copilot:
  body: should be ignored
  description: Copilot-specific`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific',
    });
  });
});

// ---------------------------------------------------------------------------
// Override validation errors
// ---------------------------------------------------------------------------

describe('parseInstructionContent — override validation', () => {
  it('warns on invalid description in override', () => {
    const longDesc = 'x'.repeat(513);
    const yaml = `${BASE_YAML}
github-copilot:
  description: ${longDesc}`;
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
    const longDesc = 'x'.repeat(513);
    const yaml = `${BASE_YAML}
github-copilot:
  description: Copilot-specific
claude-code:
  description: ${longDesc}`;
    const result = parseInstructionContent(instructionYaml(yaml));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instruction.overrides!['github-copilot']).toEqual({
      description: 'Copilot-specific',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude-code');
  });
});

// ---------------------------------------------------------------------------
// Malformed frontmatter
// ---------------------------------------------------------------------------

describe('parseInstructionContent — malformed input', () => {
  it('rejects malformed YAML frontmatter', () => {
    const content = `---
name: setup-guide
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
