import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { relative } from 'path';
import { addRules, addPrompts } from '../src/rule-add.ts';
import { runCli } from '../src/test-utils.ts';
import { readManagedPaths } from '../src/gitignore.ts';
import { removeCommand } from '../src/remove.ts';
import {
  createTempProjectDir,
  makeSimpleRulesContent,
  makeSimplePromptContent,
  createTestSourceRepo,
  readLockFileFromDisk,
} from './e2e-utils.ts';

function toManagedPath(projectRoot: string, outputPath: string): string {
  return relative(projectRoot, outputPath).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// addRules --gitignore integration tests
// ---------------------------------------------------------------------------

describe('addRules --gitignore integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates lock entry with gitignored: true and adds paths to .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const over let' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(1);

    // Lock entry should have gitignored: true
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.gitignored).toBe(true);
    expect(lock.items[0]!.outputs.length).toBeGreaterThan(0);

    // .gitignore should exist with managed section
    const managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);

    // Each output path should be in .gitignore as a relative path
    for (const outputPath of lock.items[0]!.outputs) {
      const relativePath = toManagedPath(projectDir, outputPath);
      expect(managedPaths).toContain(relativePath);
    }

    // .gitignore should have markers
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('# dotai:start');
    expect(gitignoreContent).toContain('# dotai:end');
  });

  it('does not set gitignored on lock entry when --gitignore is not used', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBeUndefined();

    // .gitignore should not exist
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
  });

  it('dry-run does not modify .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.writtenPaths).toHaveLength(0);

    // Neither lock nor .gitignore should exist
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
  });

  it('adds multiple rules with --gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
      { name: 'security', description: 'Security', body: 'Validate inputs' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(2);

    // Both lock entries should have gitignored: true
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(2);
    for (const entry of lock.items) {
      expect(entry.gitignored).toBe(true);
    }

    // All output paths should be in .gitignore
    const managedPaths = await readManagedPaths(projectDir);
    const allOutputs = lock.items.flatMap((e) => e.outputs);
    for (const outputPath of allOutputs) {
      const relativePath = toManagedPath(projectDir, outputPath);
      expect(managedPaths).toContain(relativePath);
    }
  });

  it('preserves existing .gitignore content when adding gitignored rule', async () => {
    // Pre-populate .gitignore
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('node_modules/');
    expect(gitignoreContent).toContain('.env');
    expect(gitignoreContent).toContain('# dotai:start');
    expect(gitignoreContent).toContain('# dotai:end');
  });

  it('--gitignore with --targets limits output paths', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      targets: ['cursor', 'cline'],
      gitignore: true,
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBe(true);
    expect(lock.items[0]!.agents).toHaveLength(2);
    expect(lock.items[0]!.outputs).toHaveLength(2);

    // Only cursor and cline paths should be in .gitignore
    const managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths).toHaveLength(2);
    expect(managedPaths.some((p) => p.includes('.cursor/'))).toBe(true);
    expect(managedPaths.some((p) => p.includes('.clinerules/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addPrompts --gitignore integration
// ---------------------------------------------------------------------------

describe('addPrompts --gitignore integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates lock entry with gitignored: true for prompts', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'review-code', description: 'Code review', body: 'Review this code carefully' }],
      'prompt'
    );

    const result = await addPrompts({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
    });

    expect(result.success).toBe(true);
    expect(result.promptsInstalled).toBe(1);

    // Lock entry should have gitignored: true
    const lock = await readLockFileFromDisk(projectDir);
    const promptEntry = lock.items.find((e) => e.type === 'prompt');
    expect(promptEntry).toBeDefined();
    expect(promptEntry!.gitignored).toBe(true);

    // Output paths should be in .gitignore
    const managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// --gitignore remove integration
// ---------------------------------------------------------------------------

describe('--gitignore remove integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;
  let oldCwd: string;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
    oldCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    await cleanup();
  });

  it('remove of gitignored rule cleans .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Install with --gitignore
    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    // Verify .gitignore has paths
    let managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);

    // Remove the rule
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['rule'], yes: true });

    // .gitignore managed section should be empty/removed
    managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths).toHaveLength(0);

    // Lock should be empty
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(0);
  });

  it('remove preserves other gitignored entries', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'rule-a', description: 'Rule A', body: 'Body A' },
      { name: 'rule-b', description: 'Rule B', body: 'Body B' },
    ]);

    // Install both with --gitignore
    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    // Verify both have paths in .gitignore
    let managedPaths = await readManagedPaths(projectDir);
    const pathCountBefore = managedPaths.length;
    expect(pathCountBefore).toBeGreaterThan(0);

    // Remove only rule-a
    process.chdir(projectDir);
    await removeCommand(['rule-a'], { type: ['rule'], yes: true });

    // .gitignore should still have rule-b's paths but not rule-a's
    managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);
    expect(managedPaths.length).toBeLessThan(pathCountBefore);

    // rule-b paths should still be present
    expect(managedPaths.some((p) => p.includes('rule-b'))).toBe(true);
    // rule-a paths should be gone
    expect(managedPaths.some((p) => p.includes('rule-a'))).toBe(false);

    // Lock should only have rule-b
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.name).toBe('rule-b');
    expect(lock.items[0]!.gitignored).toBe(true);
  });

  it('remove preserves non-managed .gitignore content', async () => {
    // Pre-populate .gitignore with user content
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\ndist/\n.env\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Install with --gitignore
    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      gitignore: true,
    });

    // Remove the rule
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['rule'], yes: true });

    // .gitignore should still have user content
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('node_modules/');
    expect(gitignoreContent).toContain('dist/');
    expect(gitignoreContent).toContain('.env');
    // Managed section should be removed
    expect(gitignoreContent).not.toContain('# dotai:start');
    expect(gitignoreContent).not.toContain('# dotai:end');
  });

  it('remove of non-gitignored rule does not touch .gitignore', async () => {
    // Pre-populate .gitignore
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Install WITHOUT --gitignore
    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Remove the rule
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['rule'], yes: true });

    // .gitignore should be unchanged
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toBe('node_modules/\n');
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess tests for --gitignore flag
// ---------------------------------------------------------------------------

describe('CLI --gitignore subprocess tests', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --rule --gitignore creates .gitignore with managed section', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const over let' },
    ]);

    const result = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--gitignore', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rule(s) installed');

    // .gitignore should exist with markers
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('# dotai:start');
    expect(gitignoreContent).toContain('# dotai:end');
    expect(gitignoreContent).toContain('.cursor/rules/code-style.mdc');

    // Lock should have gitignored: true
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBe(true);
  });

  it('add --rule --gitignore then remove cleans .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    // Install with --gitignore
    const addResult = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--gitignore', '-y'],
      projectDir
    );
    expect(addResult.exitCode).toBe(0);

    // Verify .gitignore has managed section
    let gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('# dotai:start');

    // Remove the rule
    const removeResult = runCli(['remove', 'code-style', '--type', 'rule', '-y'], projectDir);
    expect(removeResult.exitCode).toBe(0);

    // .gitignore managed section should be removed
    if (existsSync(join(projectDir, '.gitignore'))) {
      gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
      expect(gitignoreContent).not.toContain('# dotai:start');
      expect(gitignoreContent).not.toContain('# dotai:end');
    }

    // Lock should be empty
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(0);
  });
});
