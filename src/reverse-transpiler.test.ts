import { describe, it, expect } from 'vitest';
import { toKebabCase, serializeCanonicalRule, reverseTranspilers } from './reverse-transpiler.ts';
import { parseRuleContent } from './rule-parser.ts';
import {
  cursorRuleTranspiler,
  claudeCodeRuleTranspiler,
  copilotRuleTranspiler,
  windsurfRuleTranspiler,
  clineRuleTranspiler,
} from './rule-transpilers.ts';
import type { CanonicalRule } from './types.ts';

// ---------------------------------------------------------------------------
// Native rule content factories
// ---------------------------------------------------------------------------

function cursorRule(opts?: {
  description?: string;
  alwaysApply?: boolean;
  globs?: string;
  body?: string;
}): string {
  const lines: string[] = ['---'];
  if (opts?.description !== undefined) lines.push(`description: "${opts.description}"`);
  if (opts?.globs !== undefined) lines.push(`globs: ${opts.globs}`);
  lines.push(`alwaysApply: ${opts?.alwaysApply ?? false}`);
  lines.push('---');
  lines.push('');
  lines.push(opts?.body ?? 'Cursor rule body.');
  return lines.join('\n');
}

function claudeCodeRule(opts?: { description?: string; globs?: string[]; body?: string }): string {
  const lines: string[] = ['---'];
  if (opts?.description !== undefined) lines.push(`description: "${opts.description}"`);
  if (opts?.globs && opts.globs.length > 0) {
    lines.push('globs:');
    for (const g of opts.globs) {
      lines.push(`  - "${g}"`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(opts?.body ?? 'Claude Code rule body.');
  return lines.join('\n');
}

function copilotRule(opts?: { applyTo?: string; body?: string }): string {
  const lines: string[] = ['---'];
  lines.push(`applyTo: "${opts?.applyTo ?? '**'}"`);
  lines.push('---');
  lines.push('');
  lines.push(opts?.body ?? 'Copilot rule body.');
  return lines.join('\n');
}

function windsurfRule(opts?: {
  trigger?: string;
  description?: string;
  globs?: string[];
  body?: string;
}): string {
  const lines: string[] = ['---'];
  lines.push(`trigger: ${opts?.trigger ?? 'always_on'}`);
  if (opts?.description !== undefined) lines.push(`description: "${opts.description}"`);
  if (opts?.globs && opts.globs.length > 0) {
    lines.push('globs:');
    for (const g of opts.globs) {
      lines.push(`  - "${g}"`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(opts?.body ?? 'Windsurf rule body.');
  return lines.join('\n');
}

function clineRule(opts?: {
  name?: string;
  description?: string;
  globs?: string[];
  body?: string;
}): string {
  const lines: string[] = [];
  if (opts?.name !== undefined) {
    lines.push(`# ${opts.name}`);
    lines.push('');
  }
  if (opts?.description !== undefined) {
    lines.push(`> ${opts.description}`);
    lines.push('');
  }
  if (opts?.globs && opts.globs.length > 0) {
    lines.push(`**Applies to:** ${opts.globs.map((g) => `\`${g}\``).join(', ')}`);
    lines.push('');
  }
  lines.push(opts?.body ?? 'Cline rule body.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

describe('toKebabCase', () => {
  it('converts filenames with spaces', () => {
    expect(toKebabCase('My Rule.md')).toBe('my-rule');
  });

  it('converts filenames with underscores', () => {
    expect(toKebabCase('my_rule.md')).toBe('my-rule');
  });

  it('converts filenames with dots', () => {
    expect(toKebabCase('my.rule.md')).toBe('my-rule');
  });

  it('strips .mdc extension', () => {
    expect(toKebabCase('code-style.mdc')).toBe('code-style');
  });

  it('strips .md extension', () => {
    expect(toKebabCase('code-style.md')).toBe('code-style');
  });

  it('strips .instructions.md extension', () => {
    expect(toKebabCase('code-style.instructions.md')).toBe('code-style');
  });

  it('strips specific extension when provided', () => {
    expect(toKebabCase('code-style.instructions.md', '.instructions.md')).toBe('code-style');
  });

  it('collapses consecutive hyphens', () => {
    expect(toKebabCase('my--rule.md')).toBe('my-rule');
  });

  it('lowercases mixed-case names', () => {
    expect(toKebabCase('MyRule.md')).toBe('myrule');
  });

  it('handles names with multiple spaces and underscores', () => {
    expect(toKebabCase('My Cool_Rule.md')).toBe('my-cool-rule');
  });
});

// ---------------------------------------------------------------------------
// serializeCanonicalRule
// ---------------------------------------------------------------------------

describe('serializeCanonicalRule', () => {
  function makeRule(overrides: Partial<CanonicalRule> = {}): CanonicalRule {
    return {
      name: 'test-rule',
      description: 'A test rule',
      globs: [],
      activation: 'always',
      schemaVersion: 1,
      body: 'Rule body content.',
      ...overrides,
    };
  }

  it('produces valid YAML frontmatter + markdown body', () => {
    const rule = makeRule();
    const content = serializeCanonicalRule(rule);

    expect(content).toContain('---');
    expect(content).toContain('name: test-rule');
    expect(content).toContain('description: "A test rule"');
    expect(content).toContain('activation: always');
    expect(content).toContain('Rule body content.');
  });

  it('round-trips through parseRuleContent()', () => {
    const rule = makeRule({
      description: 'Enforce code style',
      globs: ['*.ts', '*.tsx'],
      activation: 'glob',
      body: '## Style\n\nUse const.',
    });

    const serialized = serializeCanonicalRule(rule);
    const parsed = parseRuleContent(serialized);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.rule.name).toBe(rule.name);
    expect(parsed.rule.description).toBe(rule.description);
    expect(parsed.rule.globs).toEqual(rule.globs);
    expect(parsed.rule.activation).toBe(rule.activation);
    expect(parsed.rule.body).toBe(rule.body);
  });

  it('quotes descriptions with special YAML chars', () => {
    const rule = makeRule({ description: 'Use this: always follow "rules"' });
    const content = serializeCanonicalRule(rule);

    expect(content).toContain('description: "Use this: always follow \\"rules\\""');

    // Verify it still round-trips
    const parsed = parseRuleContent(content);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.rule.description).toBe('Use this: always follow "rules"');
    }
  });

  it('omits globs array when empty', () => {
    const rule = makeRule({ globs: [] });
    const content = serializeCanonicalRule(rule);

    expect(content).not.toMatch(/^globs:/m);
  });

  it('serializes non-empty globs as YAML array', () => {
    const rule = makeRule({ globs: ['*.ts', '*.tsx'] });
    const content = serializeCanonicalRule(rule);

    expect(content).toContain('globs:');
    expect(content).toContain("  - '*.ts'");
    expect(content).toContain("  - '*.tsx'");
  });
});

// ---------------------------------------------------------------------------
// Cursor reverse parser
// ---------------------------------------------------------------------------

describe('Cursor reverse parser', () => {
  const parser = reverseTranspilers['cursor'];

  it('extracts description from frontmatter', () => {
    const content = cursorRule({ description: 'Enforce style' });
    const result = parser.parse(content, 'code-style.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('Enforce style');
    }
  });

  it('alwaysApply: true → activation: always', () => {
    const content = cursorRule({ alwaysApply: true });
    const result = parser.parse(content, 'test.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('always');
    }
  });

  it('alwaysApply: false + globs → activation: glob, splits comma-separated globs', () => {
    const content = cursorRule({ alwaysApply: false, globs: '*.ts, *.tsx' });
    const result = parser.parse(content, 'test.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('glob');
      expect(result.rule.globs).toEqual(['*.ts', '*.tsx']);
    }
  });

  it('alwaysApply: false + no globs → activation: auto', () => {
    const content = cursorRule({ alwaysApply: false });
    const result = parser.parse(content, 'test.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('auto');
    }
  });

  it('derives kebab-case name from .mdc filename', () => {
    const content = cursorRule();
    const result = parser.parse(content, 'My_Rule.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe('my-rule');
    }
  });

  it('preserves markdown body', () => {
    const content = cursorRule({ body: '## Style\n\nUse const.' });
    const result = parser.parse(content, 'test.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.body).toBe('## Style\n\nUse const.');
    }
  });

  it('uses placeholder description when missing', () => {
    const content = '---\nalwaysApply: true\n---\n\nBody.';
    const result = parser.parse(content, 'test.mdc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('Imported from Cursor');
    }
  });
});

// ---------------------------------------------------------------------------
// Claude Code reverse parser
// ---------------------------------------------------------------------------

describe('Claude Code reverse parser', () => {
  const parser = reverseTranspilers['claude-code'];

  it('extracts description from frontmatter', () => {
    const content = claudeCodeRule({ description: 'Enforce style' });
    const result = parser.parse(content, 'code-style.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('Enforce style');
    }
  });

  it('globs present → activation: glob', () => {
    const content = claudeCodeRule({ globs: ['*.ts', '*.tsx'] });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('glob');
      expect(result.rule.globs).toEqual(['*.ts', '*.tsx']);
    }
  });

  it('no globs → activation: always', () => {
    const content = claudeCodeRule();
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('always');
    }
  });

  it('preserves globs array as-is', () => {
    const content = claudeCodeRule({ globs: ['src/**/*.ts', 'lib/**/*.js'] });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.globs).toEqual(['src/**/*.ts', 'lib/**/*.js']);
    }
  });

  it('derives name from .md filename', () => {
    const content = claudeCodeRule();
    const result = parser.parse(content, 'code-style.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe('code-style');
    }
  });

  it('preserves markdown body', () => {
    const content = claudeCodeRule({ body: '## Instructions\n\nDo this.' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.body).toBe('## Instructions\n\nDo this.');
    }
  });
});

// ---------------------------------------------------------------------------
// Copilot reverse parser
// ---------------------------------------------------------------------------

describe('Copilot reverse parser', () => {
  const parser = reverseTranspilers['github-copilot'];

  it('applyTo: "**" → activation: always', () => {
    const content = copilotRule({ applyTo: '**' });
    const result = parser.parse(content, 'code-style.instructions.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('always');
    }
  });

  it('applyTo: "*.ts, *.tsx" → activation: glob, splits and trims', () => {
    const content = copilotRule({ applyTo: '*.ts, *.tsx' });
    const result = parser.parse(content, 'code-style.instructions.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('glob');
      expect(result.rule.globs).toEqual(['*.ts', '*.tsx']);
    }
  });

  it('uses placeholder description', () => {
    const content = copilotRule();
    const result = parser.parse(content, 'test.instructions.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('Imported from GitHub Copilot');
    }
  });

  it('strips .instructions.md from filename for name', () => {
    const content = copilotRule();
    const result = parser.parse(content, 'code-style.instructions.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe('code-style');
    }
  });

  it('preserves markdown body', () => {
    const content = copilotRule({ body: 'Follow these instructions.' });
    const result = parser.parse(content, 'test.instructions.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.body).toBe('Follow these instructions.');
    }
  });
});

// ---------------------------------------------------------------------------
// Windsurf reverse parser
// ---------------------------------------------------------------------------

describe('Windsurf reverse parser', () => {
  const parser = reverseTranspilers['windsurf'];

  it('trigger: always_on → always', () => {
    const content = windsurfRule({ trigger: 'always_on' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('always');
    }
  });

  it('trigger: model_decision → auto', () => {
    const content = windsurfRule({ trigger: 'model_decision' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('auto');
    }
  });

  it('trigger: manual → manual', () => {
    const content = windsurfRule({ trigger: 'manual' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('manual');
    }
  });

  it('trigger: glob → glob with globs array', () => {
    const content = windsurfRule({ trigger: 'glob', globs: ['*.ts', '*.tsx'] });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('glob');
      expect(result.rule.globs).toEqual(['*.ts', '*.tsx']);
    }
  });

  it('extracts description directly', () => {
    const content = windsurfRule({ description: 'My rule description' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('My rule description');
    }
  });

  it('preserves markdown body', () => {
    const content = windsurfRule({ body: '## Do this\n\nContent here.' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.body).toBe('## Do this\n\nContent here.');
    }
  });
});

// ---------------------------------------------------------------------------
// Cline reverse parser
// ---------------------------------------------------------------------------

describe('Cline reverse parser', () => {
  const parser = reverseTranspilers['cline'];

  it('extracts name from # heading', () => {
    const content = clineRule({ name: 'code-style', body: 'Body.' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe('code-style');
    }
  });

  it('extracts description from > blockquote', () => {
    const content = clineRule({ name: 'test', description: 'My description' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('My description');
    }
  });

  it('parses **Applies to:** inline code spans as globs', () => {
    const content = clineRule({ name: 'test', globs: ['*.ts', '*.tsx'] });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('glob');
      expect(result.rule.globs).toEqual(['*.ts', '*.tsx']);
    }
  });

  it('no globs line → activation: always', () => {
    const content = clineRule({ name: 'test', description: 'Desc' });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.activation).toBe('always');
    }
  });

  it('body excludes the parsed header lines', () => {
    const content = clineRule({
      name: 'test',
      description: 'Desc',
      body: 'Actual body content.',
    });
    const result = parser.parse(content, 'test.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.body).toBe('Actual body content.');
      expect(result.rule.body).not.toContain('# test');
      expect(result.rule.body).not.toContain('> Desc');
    }
  });

  it('falls back to filename when no heading', () => {
    const content = 'Just some body content.';
    const result = parser.parse(content, 'my-rule.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe('my-rule');
    }
  });

  it('uses placeholder when no description', () => {
    const content = '# test-rule\n\nBody.';
    const result = parser.parse(content, 'test-rule.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.description).toBe('Imported from Cline');
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: forward → reverse
// ---------------------------------------------------------------------------

describe('round-trip: forward → reverse', () => {
  function makeRule(overrides: Partial<CanonicalRule> = {}): CanonicalRule {
    return {
      name: 'test-rule',
      description: 'A test rule for round-tripping',
      globs: ['*.ts'],
      activation: 'glob',
      schemaVersion: 1,
      body: '## Instructions\n\nFollow these guidelines.',
      ...overrides,
    };
  }

  it('Cursor round-trip (lossy: auto/manual collapse to auto)', () => {
    const original = makeRule({ activation: 'always', globs: [] });
    const transpiled = cursorRuleTranspiler.transform(original, 'cursor');
    const reversed = reverseTranspilers['cursor'].parse(transpiled.content, 'test-rule.mdc');

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.name).toBe(original.name);
    expect(reversed.rule.activation).toBe('always');
    expect(reversed.rule.body).toBe(original.body);
  });

  it('Cursor round-trip preserves glob activation', () => {
    const original = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const transpiled = cursorRuleTranspiler.transform(original, 'cursor');
    const reversed = reverseTranspilers['cursor'].parse(transpiled.content, 'test-rule.mdc');

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.activation).toBe('glob');
    expect(reversed.rule.globs).toEqual(['*.ts', '*.tsx']);
  });

  it('Claude Code round-trip (lossy: always/auto collapse to always)', () => {
    const original = makeRule({ activation: 'always', globs: [] });
    const transpiled = claudeCodeRuleTranspiler.transform(original, 'claude-code');
    const reversed = reverseTranspilers['claude-code'].parse(transpiled.content, 'test-rule.md');

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.name).toBe(original.name);
    expect(reversed.rule.activation).toBe('always');
    expect(reversed.rule.body).toBe(original.body);
  });

  it('Copilot round-trip (lossy: description lost)', () => {
    const original = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const transpiled = copilotRuleTranspiler.transform(original, 'github-copilot');
    const reversed = reverseTranspilers['github-copilot'].parse(
      transpiled.content,
      'test-rule.instructions.md'
    );

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.name).toBe(original.name);
    expect(reversed.rule.description).toBe('Imported from GitHub Copilot'); // lossy
    expect(reversed.rule.activation).toBe('glob');
    expect(reversed.rule.globs).toEqual(['*.ts', '*.tsx']);
  });

  it('Windsurf round-trip (lossless)', () => {
    const original = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const transpiled = windsurfRuleTranspiler.transform(original, 'windsurf');
    const reversed = reverseTranspilers['windsurf'].parse(transpiled.content, 'test-rule.md');

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.name).toBe(original.name);
    expect(reversed.rule.description).toBe(original.description);
    expect(reversed.rule.activation).toBe(original.activation);
    expect(reversed.rule.globs).toEqual(original.globs);
    expect(reversed.rule.body).toBe(original.body);
  });

  it('Cline round-trip (near-lossless)', () => {
    const original = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const transpiled = clineRuleTranspiler.transform(original, 'cline');
    const reversed = reverseTranspilers['cline'].parse(transpiled.content, 'test-rule.md');

    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(reversed.rule.name).toBe(original.name);
    expect(reversed.rule.description).toBe(original.description);
    expect(reversed.rule.activation).toBe('glob');
    expect(reversed.rule.globs).toEqual(['*.ts', '*.tsx']);
    expect(reversed.rule.body).toBe(original.body);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('reverseTranspilers registry', () => {
  it('has entries for all 5 target agents', () => {
    expect(Object.keys(reverseTranspilers).sort()).toEqual([
      'claude-code',
      'cline',
      'cursor',
      'github-copilot',
      'windsurf',
    ]);
  });

  it('all entries have parse method', () => {
    for (const transpiler of Object.values(reverseTranspilers)) {
      expect(typeof transpiler.parse).toBe('function');
    }
  });
});
