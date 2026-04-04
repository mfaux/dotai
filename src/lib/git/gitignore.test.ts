import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

import { addToGitignore, removeFromGitignore, readManagedPaths } from './gitignore.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dotai-gitignore-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// addToGitignore
// ---------------------------------------------------------------------------

describe('addToGitignore', () => {
  it('creates .gitignore if missing', async () => {
    await addToGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n');
  });

  it('creates managed section if missing in existing .gitignore', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');

    await addToGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe(
      'node_modules/\n.env\n\n# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n'
    );
  });

  it('appends to existing managed section', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      'node_modules/\n\n# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n',
      'utf-8'
    );

    await addToGitignore(tmpDir, [join(tmpDir, '.github/instructions/code-style.instructions.md')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe(
      'node_modules/\n\n# dotai:start\n.cursor/rules/code-style.mdc\n.github/instructions/code-style.instructions.md\n# dotai:end\n'
    );
  });

  it('deduplicates paths', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n',
      'utf-8'
    );

    await addToGitignore(tmpDir, [
      join(tmpDir, '.cursor/rules/code-style.mdc'),
      join(tmpDir, '.cursor/rules/new-rule.mdc'),
    ]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe(
      '# dotai:start\n.cursor/rules/code-style.mdc\n.cursor/rules/new-rule.mdc\n# dotai:end\n'
    );
  });

  it('preserves existing non-managed content', async () => {
    const existing = '# Project gitignore\nnode_modules/\n.env\ndist/\n';
    await writeFile(join(tmpDir, '.gitignore'), existing, 'utf-8');

    await addToGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('# Project gitignore');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
    expect(content).toContain('dist/');
    expect(content).toContain('# dotai:start');
    expect(content).toContain('.cursor/rules/code-style.mdc');
    expect(content).toContain('# dotai:end');
  });

  it('handles multiple paths at once', async () => {
    await addToGitignore(tmpDir, [
      join(tmpDir, '.cursor/rules/code-style.mdc'),
      join(tmpDir, '.github/instructions/code-style.instructions.md'),
      join(tmpDir, '.claude/rules/code-style.md'),
    ]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe(
      '# dotai:start\n.cursor/rules/code-style.mdc\n.github/instructions/code-style.instructions.md\n.claude/rules/code-style.md\n# dotai:end\n'
    );
  });

  it('is a no-op for empty paths', async () => {
    await addToGitignore(tmpDir, []);
    expect(existsSync(join(tmpDir, '.gitignore'))).toBe(false);
  });

  it('preserves content after the managed section', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# before\nnode_modules/\n\n# dotai:start\n.cursor/rules/old.mdc\n# dotai:end\n\n# after\ncoverage/\n',
      'utf-8'
    );

    await addToGitignore(tmpDir, [join(tmpDir, '.cursor/rules/new.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('# before');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.cursor/rules/old.mdc');
    expect(content).toContain('.cursor/rules/new.mdc');
    expect(content).toContain('# after');
    expect(content).toContain('coverage/');
  });
});

// ---------------------------------------------------------------------------
// removeFromGitignore
// ---------------------------------------------------------------------------

describe('removeFromGitignore', () => {
  it('removes specific paths from managed section', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# dotai:start\n.cursor/rules/a.mdc\n.cursor/rules/b.mdc\n# dotai:end\n',
      'utf-8'
    );

    await removeFromGitignore(tmpDir, [join(tmpDir, '.cursor/rules/a.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('# dotai:start\n.cursor/rules/b.mdc\n# dotai:end\n');
  });

  it('removes entire section when empty', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      'node_modules/\n\n# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n',
      'utf-8'
    );

    await removeFromGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n');
    expect(content).not.toContain('# dotai:start');
    expect(content).not.toContain('# dotai:end');
  });

  it('is a no-op when section does not exist', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    await removeFromGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n');
  });

  it('is a no-op when .gitignore does not exist', async () => {
    // Should not throw
    await removeFromGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);
    expect(existsSync(join(tmpDir, '.gitignore'))).toBe(false);
  });

  it('is a no-op for empty paths', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# dotai:start\n.cursor/rules/a.mdc\n# dotai:end\n',
      'utf-8'
    );

    await removeFromGitignore(tmpDir, []);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toBe('# dotai:start\n.cursor/rules/a.mdc\n# dotai:end\n');
  });

  it('preserves content outside managed section after removal', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# before\nnode_modules/\n\n# dotai:start\n.cursor/rules/code-style.mdc\n# dotai:end\n\n# after\ncoverage/\n',
      'utf-8'
    );

    await removeFromGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('# before');
    expect(content).toContain('node_modules/');
    expect(content).toContain('# after');
    expect(content).toContain('coverage/');
    expect(content).not.toContain('# dotai:start');
  });
});

// ---------------------------------------------------------------------------
// readManagedPaths
// ---------------------------------------------------------------------------

describe('readManagedPaths', () => {
  it('returns correct paths from managed section', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      'node_modules/\n\n# dotai:start\n.cursor/rules/code-style.mdc\n.github/instructions/code-style.instructions.md\n# dotai:end\n',
      'utf-8'
    );

    const paths = await readManagedPaths(tmpDir);
    expect(paths).toEqual([
      '.cursor/rules/code-style.mdc',
      '.github/instructions/code-style.instructions.md',
    ]);
  });

  it('returns empty array when section does not exist', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const paths = await readManagedPaths(tmpDir);
    expect(paths).toEqual([]);
  });

  it('returns empty array when .gitignore does not exist', async () => {
    const paths = await readManagedPaths(tmpDir);
    expect(paths).toEqual([]);
  });

  it('filters out empty lines and comments in managed section', async () => {
    await writeFile(
      join(tmpDir, '.gitignore'),
      '# dotai:start\n.cursor/rules/a.mdc\n\n# some comment\n.cursor/rules/b.mdc\n\n# dotai:end\n',
      'utf-8'
    );

    const paths = await readManagedPaths(tmpDir);
    expect(paths).toEqual(['.cursor/rules/a.mdc', '.cursor/rules/b.mdc']);
  });
});
