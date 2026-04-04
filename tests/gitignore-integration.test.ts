import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { relative } from 'path';
import { addPrompts } from '../src/lib/install/index.ts';
import { runCli } from '../src/test-utils.ts';
import { readManagedPaths } from '../src/lib/git/index.ts';
import { removeCommand } from '../src/remove.ts';
import {
  createTempProjectDir,
  makeSimplePromptContent,
  createTestSourceRepo,
  readLockFileFromDisk,
} from './e2e-utils.ts';

function toManagedPath(projectRoot: string, outputPath: string): string {
  return relative(projectRoot, outputPath).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// addPrompts --gitignore integration tests
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

  it('creates lock entry with gitignored: true and adds paths to .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style prompts', body: 'Use const over let' }],
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
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style prompts', body: 'Use const' }],
      'prompt'
    );

    await addPrompts({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBeUndefined();

    // .gitignore should not exist
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
  });

  it('dry-run does not modify .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    const result = await addPrompts({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.writtenPaths).toHaveLength(0);

    // Neither lock nor .gitignore should exist
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
  });

  it('adds multiple prompts with --gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [
        { name: 'code-style', description: 'Style', body: 'Use const' },
        { name: 'security', description: 'Security', body: 'Validate inputs' },
      ],
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
    expect(result.promptsInstalled).toBe(2);

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

  it('preserves existing .gitignore content when adding gitignored prompt', async () => {
    // Pre-populate .gitignore
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    await addPrompts({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
    });

    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('node_modules/');
    expect(gitignoreContent).toContain('.env');
    expect(gitignoreContent).toContain('# dotai:start');
    expect(gitignoreContent).toContain('# dotai:end');
  });

  it('--gitignore with --targets limits output paths', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    await addPrompts({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      targets: ['github-copilot', 'opencode'],
      gitignore: true,
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBe(true);
    expect(lock.items[0]!.agents).toHaveLength(2);
    expect(lock.items[0]!.outputs).toHaveLength(2);

    // Only github-copilot and opencode paths should be in .gitignore
    const managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths).toHaveLength(2);
    expect(managedPaths.some((p) => p.includes('.github/prompts/'))).toBe(true);
    expect(managedPaths.some((p) => p.includes('.opencode/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addPrompts --gitignore integration (type-specific)
// ---------------------------------------------------------------------------

describe('addPrompts --gitignore integration (type-specific)', () => {
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

  it('remove of gitignored prompt cleans .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    // Install with --gitignore
    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
    });

    // Verify .gitignore has paths
    let managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);

    // Remove the prompt
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['prompt'], yes: true });

    // .gitignore managed section should be empty/removed
    managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths).toHaveLength(0);

    // Lock should be empty
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(0);
  });

  it('remove preserves other gitignored entries', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [
        { name: 'prompt-a', description: 'Prompt A', body: 'Body A' },
        { name: 'prompt-b', description: 'Prompt B', body: 'Body B' },
      ],
      'prompt'
    );

    // Install both with --gitignore
    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
    });

    // Verify both have paths in .gitignore
    let managedPaths = await readManagedPaths(projectDir);
    const pathCountBefore = managedPaths.length;
    expect(pathCountBefore).toBeGreaterThan(0);

    // Remove only prompt-a
    process.chdir(projectDir);
    await removeCommand(['prompt-a'], { type: ['prompt'], yes: true });

    // .gitignore should still have prompt-b's paths but not prompt-a's
    managedPaths = await readManagedPaths(projectDir);
    expect(managedPaths.length).toBeGreaterThan(0);
    expect(managedPaths.length).toBeLessThan(pathCountBefore);

    // prompt-b paths should still be present
    expect(managedPaths.some((p) => p.includes('prompt-b'))).toBe(true);
    // prompt-a paths should be gone
    expect(managedPaths.some((p) => p.includes('prompt-a'))).toBe(false);

    // Lock should only have prompt-b
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.name).toBe('prompt-b');
    expect(lock.items[0]!.gitignored).toBe(true);
  });

  it('remove preserves non-managed .gitignore content', async () => {
    // Pre-populate .gitignore with user content
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\ndist/\n.env\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    // Install with --gitignore
    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      gitignore: true,
    });

    // Remove the prompt
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['prompt'], yes: true });

    // .gitignore should still have user content
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('node_modules/');
    expect(gitignoreContent).toContain('dist/');
    expect(gitignoreContent).toContain('.env');
    // Managed section should be removed
    expect(gitignoreContent).not.toContain('# dotai:start');
    expect(gitignoreContent).not.toContain('# dotai:end');
  });

  it('remove of non-gitignored prompt does not touch .gitignore', async () => {
    // Pre-populate .gitignore
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style', body: 'Use const' }],
      'prompt'
    );

    // Install WITHOUT --gitignore
    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });

    // Remove the prompt
    process.chdir(projectDir);
    await removeCommand(['code-style'], { type: ['prompt'], yes: true });

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

  it('add --prompt --gitignore creates .gitignore with managed section', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style prompts', body: 'Use const over let' }],
      'prompt'
    );

    const result = runCli(
      ['add', sourceRepo, '--prompt', 'code-style', '--gitignore', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('prompt(s) installed');

    // .gitignore should exist with markers
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
    const gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('# dotai:start');
    expect(gitignoreContent).toContain('# dotai:end');
    expect(gitignoreContent).toContain('.github/prompts/code-style.prompt.md');

    // Lock should have gitignored: true
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.gitignored).toBe(true);
  });

  it('add --prompt --gitignore then remove cleans .gitignore', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Style prompts', body: 'Use const' }],
      'prompt'
    );

    // Install with --gitignore
    const addResult = runCli(
      ['add', sourceRepo, '--prompt', 'code-style', '--gitignore', '-y'],
      projectDir
    );
    expect(addResult.exitCode).toBe(0);

    // Verify .gitignore has managed section
    let gitignoreContent = await readFile(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('# dotai:start');

    // Remove the prompt
    const removeResult = runCli(['remove', 'code-style', '--type', 'prompt', '-y'], projectDir);
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
