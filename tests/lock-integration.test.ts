import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { addRules } from '../src/rule-add.ts';
import { checkRuleUpdates, updateRules } from '../src/rule-check.ts';
import { computeContentHash } from '../src/dotai-lock.ts';
import {
  createTempProjectDir,
  makeSimpleRulesContent,
  createTestSourceRepo,
  readLockFileFromDisk,
} from './e2e-utils.ts';
import { mkdir } from 'fs/promises';

// ---------------------------------------------------------------------------
// addRules — integration with lock file
// ---------------------------------------------------------------------------

describe('addRules → lock file integration', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates .dotai-lock.json with installed rule entry', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Code style rules', body: 'Use const over let' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(1);

    // Verify lock file was created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.version).toBe(1);
    expect(lock.items).toHaveLength(1);

    const entry = lock.items[0]!;
    expect(entry.type).toBe('rule');
    expect(entry.name).toBe('code-style');
    expect(entry.source).toBe('test/repo');
    expect(entry.format).toBe('canonical');
    expect(entry.agents).toHaveLength(4);
    expect(entry.hash).toBeTruthy();
    expect(entry.installedAt).toBeTruthy();
    expect(entry.outputs).toHaveLength(4);
  });

  it('writes correct content hash in lock entry', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Code style rules', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    const entry = lock.items[0]!;

    // Hash should be the SHA-256 of the raw content (including frontmatter)
    const rawContent = makeSimpleRulesContent('code-style', 'Code style rules', 'Use const');
    const expectedHash = computeContentHash(rawContent);
    expect(entry.hash).toBe(expectedHash);
  });

  it('records output paths matching actual written files', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    const entry = lock.items[0]!;

    // Every output path should exist on disk
    for (const outputPath of entry.outputs) {
      expect(existsSync(outputPath)).toBe(true);
    }

    // Output paths should match written paths
    expect(new Set(entry.outputs)).toEqual(new Set(result.writtenPaths));
  });

  it('records correct agents in lock entry based on --targets filter', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      targets: ['cursor', 'opencode'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    const entry = lock.items[0]!;

    expect(entry.agents).toHaveLength(2);
    expect(entry.agents).toContain('cursor');
    expect(entry.agents).toContain('opencode');
    expect(entry.outputs).toHaveLength(2);
  });

  it('installs multiple rules with separate lock entries', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
      { name: 'security', description: 'Security', body: 'Validate input' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(2);

    const names = lock.items.map((e) => e.name).sort();
    expect(names).toEqual(['code-style', 'security']);

    // Each entry should have its own outputs
    for (const entry of lock.items) {
      expect(entry.outputs.length).toBeGreaterThan(0);
      expect(entry.source).toBe('test/repo');
    }
  });

  it('skips lock file write in dry-run mode', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.rulesInstalled).toBe(1);
    expect(result.writtenPaths).toHaveLength(0);

    // Lock file should NOT exist (dry-run)
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
  });

  it('does not write transpiled files in dry-run mode', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      dryRun: true,
    });

    // No agent directories should be created
    expect(existsSync(join(projectDir, '.cursor'))).toBe(false);
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(join(projectDir, '.github'))).toBe(false);
  });

  it('blocks collision from pre-existing user file', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Create a pre-existing user file at one of the target paths
    const cursorRulesDir = join(projectDir, '.cursor', 'rules');
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(join(cursorRulesDir, 'code-style.mdc'), 'user content');

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('collision');

    // Lock file should NOT be created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);

    // User file should be untouched
    const userContent = await readFile(join(cursorRulesDir, 'code-style.mdc'), 'utf-8');
    expect(userContent).toBe('user content');
  });

  it('force overrides collision and writes lock entry', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Create a pre-existing user file
    const cursorRulesDir = join(projectDir, '.cursor', 'rules');
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(join(cursorRulesDir, 'code-style.mdc'), 'user content');

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      force: true,
    });

    expect(result.success).toBe(true);

    // Lock file should exist with the forced entry
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.name).toBe('code-style');

    // Cursor file should be overwritten
    const cursorContent = await readFile(join(cursorRulesDir, 'code-style.mdc'), 'utf-8');
    expect(cursorContent).not.toBe('user content');
    expect(cursorContent).toContain('Use const');
  });

  it('allows re-install from same source (update path)', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Original body' },
    ]);

    // First install
    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Modify source
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Updated body')
    );

    // Re-install from same source
    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    expect(result.success).toBe(true);

    // Lock entry should have updated hash
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);

    const updatedContent = makeSimpleRulesContent('code-style', 'Style', 'Updated body');
    expect(lock.items[0]!.hash).toBe(computeContentHash(updatedContent));

    // Transpiled content should be updated
    const cursorContent = await readFile(
      join(projectDir, '.cursor', 'rules', 'code-style.mdc'),
      'utf-8'
    );
    expect(cursorContent).toContain('Updated body');
  });

  it('blocks same-name from different source', async () => {
    const sourceRepo1 = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'v1' },
    ]);

    // First install from source 1
    await addRules({
      source: 'owner/repo-a',
      sourcePath: sourceRepo1,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Create a second source repo with same rule name
    const sourceRepo2Dir = join(tempDir, 'source-repo-2');
    await mkdir(sourceRepo2Dir, { recursive: true });
    await writeFile(
      join(sourceRepo2Dir, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'v2')
    );

    // Second install from different source — should be blocked
    const result = await addRules({
      source: 'owner/repo-b',
      sourcePath: sourceRepo2Dir,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('collision');

    // Lock should still have original source
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.source).toBe('owner/repo-a');
  });

  it('returns error when no rules found in source', async () => {
    // Empty source repo
    const emptyRepo = join(tempDir, 'empty-repo');
    await mkdir(emptyRepo, { recursive: true });

    const result = await addRules({
      source: 'test/repo',
      sourcePath: emptyRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No rules found');
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
  });

  it('returns error when requested rule name not found', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    const result = await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['nonexistent'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No matching rules');
    expect(result.error).toContain('code-style');
  });

  it('preserves installedAt on re-install (update)', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Original' },
    ]);

    // First install
    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock1 = await readLockFileFromDisk(projectDir);
    const originalInstalledAt = lock1.items[0]!.installedAt;

    // Small delay
    await new Promise((r) => setTimeout(r, 50));

    // Modify source and re-install
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Updated')
    );

    await addRules({
      source: 'test/repo',
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock2 = await readLockFileFromDisk(projectDir);
    // addRules creates a new entry with new installedAt — upsertLockEntry preserves
    // the original installedAt when the entry already exists
    // Note: addRules() sets installedAt = new Date().toISOString(), but upsertLockEntry()
    // preserves the original installedAt if the entry existed. The behavior depends on
    // whether the entry was already in the lock when upsertLockEntry is called.
    // Since we read the lock before install, then upsert, the original is preserved.
    expect(lock2.items[0]!.installedAt).toBe(originalInstalledAt);
  });
});

// ---------------------------------------------------------------------------
// addRules → checkRuleUpdates → updateRules (lock lifecycle)
// ---------------------------------------------------------------------------

describe('addRules → check → update lock lifecycle', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('check reports no updates immediately after addRules', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const result = await checkRuleUpdates(projectDir);
    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('check detects update after source content changes', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Version 1' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Modify source content
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Version 2')
    );

    const result = await checkRuleUpdates(projectDir);
    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('code-style');
  });

  it('updateRules re-installs changed rules and updates lock hash', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Version 1' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lockBefore = await readLockFileFromDisk(projectDir);
    const hashBefore = lockBefore.items[0]!.hash;

    // Modify source
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Version 2')
    );

    const result = await updateRules(projectDir);
    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);

    // Lock hash should be updated
    const lockAfter = await readLockFileFromDisk(projectDir);
    expect(lockAfter.items).toHaveLength(1);
    expect(lockAfter.items[0]!.hash).not.toBe(hashBefore);

    // Transpiled files should have new content
    const cursorContent = await readFile(
      join(projectDir, '.cursor', 'rules', 'code-style.mdc'),
      'utf-8'
    );
    expect(cursorContent).toContain('Version 2');
  });

  it('updateRules preserves installedAt from original install', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Version 1' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lockBefore = await readLockFileFromDisk(projectDir);
    const originalInstalledAt = lockBefore.items[0]!.installedAt;

    // Modify source
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style', 'Version 2')
    );

    await updateRules(projectDir);

    const lockAfter = await readLockFileFromDisk(projectDir);
    expect(lockAfter.items[0]!.installedAt).toBe(originalInstalledAt);
  });

  it('check reports error when rule removed from source after install', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Remove the rule and replace with a different one
    const { unlinkSync } = await import('fs');
    unlinkSync(join(sourceRepo, 'RULES.md'));
    await writeFile(
      join(sourceRepo, 'RULES.md'),
      makeSimpleRulesContent('other-rule', 'Other', 'Other body')
    );

    const result = await checkRuleUpdates(projectDir);
    expect(result.totalChecked).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('no longer found');
  });

  it('handles multiple rules with mixed update status', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'rule-a', description: 'Rule A', body: 'Body A' },
      { name: 'rule-b', description: 'Rule B', body: 'Body B' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Only modify rule-b
    const ruleBDir = join(sourceRepo, 'rules', 'rule-b');
    await writeFile(
      join(ruleBDir, 'RULES.md'),
      makeSimpleRulesContent('rule-b', 'Rule B', 'Body B Updated')
    );

    // Check — only rule-b should have an update
    const checkResult = await checkRuleUpdates(projectDir);
    expect(checkResult.totalChecked).toBe(2);
    expect(checkResult.updates).toHaveLength(1);
    expect(checkResult.updates[0]!.entry.name).toBe('rule-b');

    // Update — only rule-b should be updated
    const updateResult = await updateRules(projectDir);
    expect(updateResult.successCount).toBe(1);

    // Both rules should still be in lock
    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(2);

    // Rule B should have new content in transpiled file
    const cursorB = await readFile(join(projectDir, '.cursor', 'rules', 'rule-b.mdc'), 'utf-8');
    expect(cursorB).toContain('Body B Updated');
  });

  it('no lock file write when updateRules finds no changes', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const { statSync } = await import('fs');
    const mtimeBefore = statSync(join(projectDir, '.dotai-lock.json')).mtimeMs;

    // Small delay to detect mtime changes
    await new Promise((r) => setTimeout(r, 50));

    const result = await updateRules(projectDir);
    expect(result.successCount).toBe(0);

    const mtimeAfter = statSync(join(projectDir, '.dotai-lock.json')).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('check returns empty when no lock file exists', async () => {
    const result = await checkRuleUpdates(projectDir);
    expect(result.totalChecked).toBe(0);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('update returns empty when no lock file exists', async () => {
    const result = await updateRules(projectDir);
    expect(result.totalChecked).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it('lock file is sorted deterministically after multiple operations', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'zebra-rule', description: 'Zebra', body: 'Zebra body' },
      { name: 'alpha-rule', description: 'Alpha', body: 'Alpha body' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items[0]!.name).toBe('alpha-rule');
    expect(lock.items[1]!.name).toBe('zebra-rule');

    // Update source — zebra-rule changes
    const zebraDir = join(sourceRepo, 'rules', 'zebra-rule');
    await writeFile(
      join(zebraDir, 'RULES.md'),
      makeSimpleRulesContent('zebra-rule', 'Zebra', 'Zebra body updated')
    );

    await updateRules(projectDir);

    // After update, sorting should still be deterministic
    const lockAfter = await readLockFileFromDisk(projectDir);
    expect(lockAfter.items[0]!.name).toBe('alpha-rule');
    expect(lockAfter.items[1]!.name).toBe('zebra-rule');
  });
});
