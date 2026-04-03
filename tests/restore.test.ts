import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { runCli } from '../src/test-utils.ts';
import { addPrompts, addAgents } from '../src/context-add.ts';
import { writeDotaiLock, createEmptyLock, readDotaiLock } from '../src/dotai-lock.ts';
import { createTestSourceRepo } from './e2e-utils.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'restore-test-'));
}

// ---------------------------------------------------------------------------
// CLI restore — restore prompts and agents from .dotai-lock.json
// After the routing change, restore is invoked via 'dotai restore' (not 'dotai install')
// ---------------------------------------------------------------------------

describe('dotai restore — restore prompts and agents from .dotai-lock.json', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('restores prompts from .dotai-lock.json via restore command', async () => {
    // Step 1: Create source repo with a prompt
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Enforce code style', body: 'Use const over let' }],
      'prompt'
    );

    // Step 2: Install the prompt first to populate .dotai-lock.json
    const addResult = await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });
    expect(addResult.success).toBe(true);

    // Verify lock file exists
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    // Step 3: Delete the transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.opencode'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore from lock
    const result = runCli(['restore'], projectDir);

    // Should show restore behavior
    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');

    // Transpiled files should be recreated
    expect(existsSync(join(projectDir, '.github', 'prompts', 'code-style.prompt.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'commands', 'code-style.md'))).toBe(true);
  });

  it('restores both prompts and agents from same source', async () => {
    // Create separate source repos for prompts and agents
    const promptRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Enforce code style', body: 'Use const' }],
      'prompt'
    );
    const agentRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'review-code', description: 'Review code', body: 'Review the code.' }],
      'agent'
    );

    // Install both
    await addPrompts({
      source: promptRepo,
      sourcePath: promptRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });
    await addAgents({
      source: agentRepo,
      sourcePath: agentRepo,
      projectRoot: projectDir,
      agentNames: ['*'],
      force: true,
    });

    // Verify lock file has both
    const { lock } = await readDotaiLock(projectDir);
    expect(lock.items).toHaveLength(2);

    // Delete transpiled files
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.opencode'), { recursive: true, force: true });

    // Restore
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');
    // Should mention both prompts and agents
    expect(result.stdout).toContain('prompt');
    expect(result.stdout).toContain('agent');
  });

  it('shows nothing-found message when both lock files are empty', async () => {
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('No project skills found in skills-lock.json');
  });

  it('shows nothing-found message with empty .dotai-lock.json', async () => {
    // Write an empty dotai lock file
    await writeDotaiLock(createEmptyLock(), projectDir);

    const result = runCli(['restore'], projectDir);

    // Should show the "no project skills" message since both locks are empty
    expect(result.stdout).toContain('No project skills found in skills-lock.json');
  });

  it('handles non-existent source gracefully during restore', async () => {
    // Manually write a .dotai-lock.json with a non-existent local source
    const nonExistentSource = join(tempDir, 'does-not-exist');
    const lock = createEmptyLock();
    lock.items.push({
      type: 'prompt',
      name: 'phantom-prompt',
      source: nonExistentSource,
      format: 'canonical',
      agents: ['claude-code', 'github-copilot', 'opencode'],
      hash: 'abc123',
      installedAt: '2026-03-01T00:00:00.000Z',
      outputs: [],
    });
    await writeDotaiLock(lock, projectDir);

    // Should not crash — error is caught per-source
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');
    // Should log an error for the failed source but not crash
    expect(result.exitCode).toBe(0);
  });

  it('i alias with no args routes to add (not restore)', async () => {
    // After routing change, 'i' is an alias for 'add', not 'restore'
    const result = runCli(['i'], projectDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('experimental_install restores prompts from .dotai-lock.json', async () => {
    // Create source repo and install a prompt
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Code style', body: 'Use const' }],
      'prompt'
    );

    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });

    // Delete transpiled files
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.opencode'), { recursive: true, force: true });

    // Run with experimental_install
    const result = runCli(['experimental_install'], projectDir);

    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');
  });

  it('restores prompts with force (overwrites existing files)', async () => {
    // Create source repo and install a prompt
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Code style', body: 'Use const' }],
      'prompt'
    );

    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });

    // Modify transpiled file to simulate user edit
    const copilotFile = join(projectDir, '.github', 'prompts', 'code-style.prompt.md');
    expect(existsSync(copilotFile)).toBe(true);
    await writeFile(copilotFile, 'user modified content');

    // Restore should overwrite (restore uses force: true)
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');

    // File should be restored to original content
    const restoredContent = await readFile(copilotFile, 'utf-8');
    expect(restoredContent).toContain('Use const');
    expect(restoredContent).not.toBe('user modified content');
  });

  it('restores agents from .dotai-lock.json via restore command', async () => {
    // Step 1: Create source repo with an agent
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'test-helper', description: 'A test helper agent', body: 'Help with testing.' }],
      'agent'
    );

    // Step 2: Install the agent first to populate .dotai-lock.json
    const addResult = await addAgents({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      agentNames: ['*'],
      force: true,
    });
    expect(addResult.success).toBe(true);

    // Verify lock file exists and has agent entry
    const { lock } = await readDotaiLock(projectDir);
    const agentEntries = lock.items.filter((e) => e.type === 'agent');
    expect(agentEntries.length).toBe(1);

    // Step 3: Delete transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.opencode'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore agents from lock
    const result = runCli(['restore'], projectDir);

    // Should show restore behavior
    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');
    expect(result.stdout).toContain('agent');
  });

  it('restores prompts only to agents listed in lock entry', async () => {
    // Step 1: Create source repo with a prompt
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Enforce code style', body: 'Use const over let' }],
      'prompt'
    );

    // Step 2: Install the prompt for github-copilot only
    const addResult = await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
      targets: ['github-copilot'],
    });
    expect(addResult.success).toBe(true);

    // Verify lock entry has agents: ['github-copilot'] only
    const { lock } = await readDotaiLock(projectDir);
    const promptEntry = lock.items.find((e) => e.type === 'prompt');
    expect(promptEntry?.agents).toEqual(['github-copilot']);

    // Step 3: Delete transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.github'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore only to github-copilot
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');

    // Copilot files should be recreated
    expect(existsSync(join(projectDir, '.github', 'prompts', 'code-style.prompt.md'))).toBe(true);

    // Other agents should NOT have files
    expect(existsSync(join(projectDir, '.claude', 'commands', 'code-style.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.opencode', 'commands', 'code-style.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routing edge cases (supplement to existing tests in add.test.ts)
// ---------------------------------------------------------------------------

describe('install routing edge cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('install with flags but no positional args routes to add (not restore)', () => {
    // After routing change, 'install' always routes to 'add'
    const result = runCli(['install', '-y'], tempDir);

    // Should show add behavior (error because no source)
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('i with --global flag and no args routes to add (not restore)', () => {
    const result = runCli(['i', '-g'], tempDir);

    // Should show add behavior (error because no source)
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('add with no args still shows error (not restore)', () => {
    const result = runCli(['add'], tempDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('a with no args still shows error (not restore)', () => {
    const result = runCli(['a'], tempDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });
});
