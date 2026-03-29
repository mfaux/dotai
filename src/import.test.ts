import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { executeImport } from './import.ts';
import { parseRuleContent } from './rule-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function createFile(relativePath: string, content: string): void {
  const fullPath = join(tmpDir, relativePath);
  const dir = fullPath.replace(/[/\\][^/\\]+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

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
    for (const g of opts.globs) lines.push(`  - "${g}"`);
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

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dotai-import-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Discovery + parsing
// ---------------------------------------------------------------------------

describe('import pipeline — discovery + parsing', () => {
  it('discovers Cursor rules from .cursor/rules/*.mdc', () => {
    createFile('.cursor/rules/code-style.mdc', cursorRule({ description: 'Style' }));

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.agent).toBe('cursor');
    expect(result.imported[0]!.name).toBe('code-style');
  });

  it('discovers Claude Code rules from .claude/rules/*.md', () => {
    createFile('.claude/rules/testing.md', claudeCodeRule({ description: 'Testing' }));

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.agent).toBe('claude-code');
  });

  it('discovers Copilot rules from .github/instructions/*.instructions.md', () => {
    createFile(
      '.github/instructions/api-patterns.instructions.md',
      copilotRule({ applyTo: '*.ts' })
    );

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.agent).toBe('github-copilot');
    expect(result.imported[0]!.name).toBe('api-patterns');
  });

  it('discovers rules from multiple agents simultaneously', () => {
    createFile('.cursor/rules/style.mdc', cursorRule({ description: 'Style' }));
    createFile('.claude/rules/testing.md', claudeCodeRule({ description: 'Testing' }));
    createFile(
      '.github/instructions/api-patterns.instructions.md',
      copilotRule({ applyTo: '*.ts' })
    );

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.imported.length).toBeGreaterThanOrEqual(3);
  });

  it('reports warning for files that fail to parse', () => {
    // Use content that will cause gray-matter to throw a YAML parse error
    createFile(
      '.cursor/rules/bad.mdc',
      '---\n: :\n  - : :\n    invalid: [unterminated\n---\n\nBody.'
    );

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

describe('import pipeline — output', () => {
  it('writes rules/{name}/RULES.md for each parsed rule', () => {
    createFile('.cursor/rules/code-style.mdc', cursorRule({ description: 'Style rules' }));

    executeImport({ projectRoot: tmpDir });

    const outputPath = join(tmpDir, 'rules', 'code-style', 'RULES.md');
    expect(existsSync(outputPath)).toBe(true);
  });

  it('output files parse successfully via parseRuleContent()', () => {
    createFile(
      '.cursor/rules/code-style.mdc',
      cursorRule({ description: 'Style', alwaysApply: true })
    );

    executeImport({ projectRoot: tmpDir });

    const outputPath = join(tmpDir, 'rules', 'code-style', 'RULES.md');
    const content = readFileSync(outputPath, 'utf-8');
    const parsed = parseRuleContent(content);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.rule.name).toBe('code-style');
      expect(parsed.rule.description).toBe('Style');
    }
  });

  it('respects --output dir flag', () => {
    createFile('.cursor/rules/test.mdc', cursorRule());

    executeImport({ projectRoot: tmpDir, outputDir: 'custom-rules' });

    const outputPath = join(tmpDir, 'custom-rules', 'test', 'RULES.md');
    expect(existsSync(outputPath)).toBe(true);
  });

  it('creates output directories as needed', () => {
    createFile('.cursor/rules/new-rule.mdc', cursorRule());

    executeImport({ projectRoot: tmpDir });

    const ruleDir = join(tmpDir, 'rules', 'new-rule');
    expect(existsSync(ruleDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('import pipeline — deduplication', () => {
  it('keeps first rule when same name from multiple agents', () => {
    // Both will produce name "code-style"
    createFile('.cursor/rules/code-style.mdc', cursorRule({ description: 'Cursor style' }));
    createFile('.claude/rules/code-style.md', claudeCodeRule({ description: 'Claude style' }));

    const result = executeImport({ projectRoot: tmpDir });

    // One imported, one warned about as duplicate
    expect(result.imported).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Collision handling
// ---------------------------------------------------------------------------

describe('import pipeline — collision handling', () => {
  it('skips when rules/{name}/RULES.md already exists', () => {
    createFile('.cursor/rules/existing.mdc', cursorRule());
    createFile(
      'rules/existing/RULES.md',
      '---\nname: existing\ndescription: Already here\nactivation: always\n---\n\nExisting.'
    );

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('already exists');
  });

  it('overwrites with --force', () => {
    createFile('.cursor/rules/existing.mdc', cursorRule({ description: 'New content' }));
    createFile(
      'rules/existing/RULES.md',
      '---\nname: existing\ndescription: Old\nactivation: always\n---\n\nOld.'
    );

    const result = executeImport({ projectRoot: tmpDir, force: true });

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const content = readFileSync(join(tmpDir, 'rules', 'existing', 'RULES.md'), 'utf-8');
    expect(content).toContain('New content');
  });

  it('reports skipped files', () => {
    createFile('.cursor/rules/test.mdc', cursorRule());
    createFile(
      'rules/test/RULES.md',
      '---\nname: test\ndescription: Existing\nactivation: always\n---\n\nBody.'
    );

    const result = executeImport({ projectRoot: tmpDir });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.outputPath).toContain('test/RULES.md');
  });
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

describe('import pipeline — --dry-run', () => {
  it('reports what would be written', () => {
    createFile('.cursor/rules/test.mdc', cursorRule());

    const result = executeImport({ projectRoot: tmpDir, dryRun: true });

    expect(result.imported).toHaveLength(1);
  });

  it('creates no files', () => {
    createFile('.cursor/rules/test.mdc', cursorRule());

    executeImport({ projectRoot: tmpDir, dryRun: true });

    expect(existsSync(join(tmpDir, 'rules', 'test', 'RULES.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// --from filtering
// ---------------------------------------------------------------------------

describe('import pipeline — --from filtering', () => {
  it('only imports from specified agents', () => {
    createFile('.cursor/rules/cursor-rule.mdc', cursorRule());
    createFile('.claude/rules/claude-rule.md', claudeCodeRule());

    const result = executeImport({ projectRoot: tmpDir, from: ['cursor'] });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.agent).toBe('cursor');
  });

  it('ignores rules from other agents', () => {
    createFile('.cursor/rules/test.mdc', cursorRule());
    createFile('.claude/rules/test2.md', claudeCodeRule());

    const result = executeImport({ projectRoot: tmpDir, from: ['claude-code'] });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.agent).toBe('claude-code');
  });
});
