import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { addRules } from '../src/rule-add.ts';
import { updateRules } from '../src/rule-check.ts';
import { runCli } from '../src/test-utils.ts';
import {
  createTempProjectDir,
  makeSimpleRulesContent,
  createTestSourceRepo,
  readLockFileFromDisk,
} from './e2e-utils.ts';

// ---------------------------------------------------------------------------
// Append mode — integration tests
// ---------------------------------------------------------------------------

describe('addRules --append integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('append mode creates AGENTS.md and CLAUDE.md with markers', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Code style rules', body: 'Use const over let' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(1);

    // AGENTS.md should exist with markers
    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- dotai:code-style:start -->');
    expect(agentsMd).toContain('<!-- dotai:code-style:end -->');
    expect(agentsMd).toContain('Use const over let');

    // CLAUDE.md should exist with markers
    const claudeMd = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('<!-- dotai:code-style:start -->');
    expect(claudeMd).toContain('<!-- dotai:code-style:end -->');
    expect(claudeMd).toContain('Use const over let');

    // Per-rule files should still be written for cursor and opencode
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.opencode', 'rules', 'code-style.md'))).toBe(true);

    // Per-rule files should NOT be written for copilot/claude (append mode instead)
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(false);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(false);
  });

  it('append mode lock entry has append: true', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.append).toBe(true);
    expect(lock.items[0]!.outputs).toContain(join(projectDir, 'AGENTS.md'));
    expect(lock.items[0]!.outputs).toContain(join(projectDir, 'CLAUDE.md'));
  });

  it('append mode appends multiple rules to the same files', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const over let' },
      { name: 'security', description: 'Security', body: 'Validate all inputs' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(2);

    // AGENTS.md should have both sections
    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- dotai:code-style:start -->');
    expect(agentsMd).toContain('<!-- dotai:code-style:end -->');
    expect(agentsMd).toContain('<!-- dotai:security:start -->');
    expect(agentsMd).toContain('<!-- dotai:security:end -->');
    expect(agentsMd).toContain('Use const over let');
    expect(agentsMd).toContain('Validate all inputs');

    // Lock should have 2 entries, both with append
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(2);
    expect(lock.items.every((e) => e.append === true)).toBe(true);
  });

  it('append mode preserves existing file content', async () => {
    // Pre-populate AGENTS.md with user content
    await writeFile(join(projectDir, 'AGENTS.md'), '# My Project\n\nExisting instructions.\n');

    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    // User content preserved
    expect(agentsMd).toContain('# My Project');
    expect(agentsMd).toContain('Existing instructions.');
    // Dotai section added
    expect(agentsMd).toContain('<!-- dotai:code-style:start -->');
    expect(agentsMd).toContain('Use const');
  });

  it('append mode re-install is idempotent (updates section)', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Version 1' },
    ]);

    // First install
    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    // Modify source
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Version 2')
    );

    // Re-install
    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });

    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('Version 2');
    expect(agentsMd).not.toContain('Version 1');

    // Should have exactly one start/end marker pair
    const startCount = agentsMd.split('<!-- dotai:code-style:start -->').length - 1;
    const endCount = agentsMd.split('<!-- dotai:code-style:end -->').length - 1;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it('append mode dry-run does not write files', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.writtenPaths).toHaveLength(0);
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Append mode — remove integration tests (via CLI subprocess)
// ---------------------------------------------------------------------------

describe('CLI --append add + remove integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --append then remove --type rule removes section from AGENTS.md', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const over let' },
    ]);

    // Install with append
    const addResult = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--append', '-y'],
      projectDir
    );
    expect(addResult.exitCode).toBe(0);

    // Verify AGENTS.md exists with markers
    const agentsBefore = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsBefore).toContain('<!-- dotai:code-style:start -->');

    // Remove the rule
    const removeResult = runCli(['remove', 'code-style', '--type', 'rule', '-y'], projectDir);
    expect(removeResult.exitCode).toBe(0);

    // AGENTS.md should no longer have the section (file may be empty/deleted)
    if (existsSync(join(projectDir, 'AGENTS.md'))) {
      const agentsAfter = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
      expect(agentsAfter).not.toContain('<!-- dotai:code-style:start -->');
      expect(agentsAfter).not.toContain('<!-- dotai:code-style:end -->');
    }

    // CLAUDE.md should also be cleaned up
    if (existsSync(join(projectDir, 'CLAUDE.md'))) {
      const claudeAfter = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');
      expect(claudeAfter).not.toContain('<!-- dotai:code-style:start -->');
    }

    // Lock should be empty
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(0);
  });

  it('remove preserves other sections when removing one append rule', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
      { name: 'security', description: 'Security', body: 'Validate inputs' },
    ]);

    // Install both with append
    const addResult = runCli(['add', sourceRepo, '--rule', '*', '--append', '-y'], projectDir);
    expect(addResult.exitCode).toBe(0);

    // Verify both sections exist
    const agentsBefore = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsBefore).toContain('<!-- dotai:code-style:start -->');
    expect(agentsBefore).toContain('<!-- dotai:security:start -->');

    // Remove only code-style
    const removeResult = runCli(['remove', 'code-style', '--type', 'rule', '-y'], projectDir);
    expect(removeResult.exitCode).toBe(0);

    // AGENTS.md should still have security section but not code-style
    const agentsAfter = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsAfter).not.toContain('<!-- dotai:code-style:start -->');
    expect(agentsAfter).toContain('<!-- dotai:security:start -->');
    expect(agentsAfter).toContain('Validate inputs');

    // Lock should have only security
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.name).toBe('security');
  });

  it('remove deletes empty file after removing last append section', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Install with append
    runCli(['add', sourceRepo, '--rule', 'code-style', '--append', '-y'], projectDir);

    // AGENTS.md should exist
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true);

    // Remove
    runCli(['remove', 'code-style', '--type', 'rule', '-y'], projectDir);

    // AGENTS.md should be deleted (was only dotai content)
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
  });

  it('remove preserves user content in append target after section removal', async () => {
    // Pre-populate AGENTS.md with user content
    await writeFile(join(projectDir, 'AGENTS.md'), '# My Project\n\nProject instructions here.\n');

    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Install with append
    runCli(['add', sourceRepo, '--rule', 'code-style', '--append', '-y'], projectDir);

    // Verify section was added
    const before = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(before).toContain('<!-- dotai:code-style:start -->');
    expect(before).toContain('# My Project');

    // Remove
    runCli(['remove', 'code-style', '--type', 'rule', '-y'], projectDir);

    // AGENTS.md should still exist with user content, but without dotai section
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true);
    const after = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(after).toContain('# My Project');
    expect(after).toContain('Project instructions here.');
    expect(after).not.toContain('<!-- dotai:code-style:start -->');
    expect(after).not.toContain('<!-- dotai:code-style:end -->');
  });

  it('update preserves append mode in lock entries', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Version 1' },
    ]);

    // Install with append
    const addResult = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--append', '-y'],
      projectDir
    );
    expect(addResult.exitCode).toBe(0);

    // Verify lock has append: true
    const lockBefore = await readLockFileFromDisk(projectDir);
    expect(lockBefore.items[0]!.append).toBe(true);

    // Modify source
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Version 2')
    );

    // Update
    const updateResult = await updateRules(projectDir);
    expect(updateResult.successCount).toBe(1);

    // Lock should still have append: true
    const lockAfter = await readLockFileFromDisk(projectDir);
    expect(lockAfter.items[0]!.append).toBe(true);

    // AGENTS.md should have updated content
    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('Version 2');
    expect(agentsMd).not.toContain('Version 1');
  });
});
