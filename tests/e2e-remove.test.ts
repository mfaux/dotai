import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import {
  createTempProject,
  cleanupProject,
  makeRuleContent,
  makePromptContent,
  makeAgentContent,
  writeCanonicalFile,
  assertFileExists,
  assertFileNotExists,
  getExpectedOutputPath,
  assertLockEntry,
  assertLockEntryCount,
  assertNoLockEntry,
  getLockFile,
  ALL_AGENTS,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addRules, addPrompts, addAgents } from '../src/rule-add.ts';
import { removeCommand } from '../src/remove.ts';

// ---------------------------------------------------------------------------
// E2E Remove Flow Tests
//
// These tests exercise the full lifecycle: install → remove → verify that
// all output files are deleted and lock entries are removed.
//
// Each test:
//   1. Creates a source repo with canonical context files
//   2. Installs them via addRules/addPrompts/addAgents
//   3. Verifies output files and lock entries exist
//   4. Calls removeCommand with --yes and --type to remove items
//   5. Verifies output files are deleted and lock entries removed
//
// Note: removeCommand uses process.cwd() to locate the lock file, so tests
// chdir into the project root before calling remove and restore afterwards.
// ---------------------------------------------------------------------------

describe('E2E remove flow', () => {
  let projectRoot: string;
  let sourceRepo: string;
  let oldCwd: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-remove-');
    sourceRepo = createTempProject('dotai-e2e-remove-src-');
    oldCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(oldCwd);
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
  });

  // -------------------------------------------------------------------------
  // Remove a rule → all output files deleted, lock entry removed
  // -------------------------------------------------------------------------

  describe('remove rule', () => {
    it('removes all output files and lock entry for a canonical rule', async () => {
      // 1. Install a canonical rule
      const content = makeRuleContent('code-style', { body: 'Use const.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', content);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Verify install succeeded
      for (const agent of ALL_AGENTS) {
        const outPath = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileExists(outPath);
      }
      await assertLockEntry(projectRoot, 'rule', 'code-style');
      await assertLockEntryCount(projectRoot, 1);

      // 2. Remove the rule
      process.chdir(projectRoot);
      await removeCommand(['code-style'], { type: ['rule'], yes: true });

      // 3. Verify all output files are deleted
      for (const agent of ALL_AGENTS) {
        const outPath = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileNotExists(outPath);
      }

      // 4. Verify lock entry is removed
      await assertNoLockEntry(projectRoot, 'rule', 'code-style');
      await assertLockEntryCount(projectRoot, 0);
    });

    it('removes only the named rule when multiple rules are installed', async () => {
      // Install two rules
      writeCanonicalFile(sourceRepo, 'rule', 'rule-a', makeRuleContent('rule-a', { body: 'A' }));
      writeCanonicalFile(sourceRepo, 'rule', 'rule-b', makeRuleContent('rule-b', { body: 'B' }));

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove only rule-a
      process.chdir(projectRoot);
      await removeCommand(['rule-a'], { type: ['rule'], yes: true });

      // rule-a should be gone
      for (const agent of ALL_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'rule-a'));
      }
      await assertNoLockEntry(projectRoot, 'rule', 'rule-a');

      // rule-b should still exist
      for (const agent of ALL_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'rule-b'));
      }
      await assertLockEntry(projectRoot, 'rule', 'rule-b');
      await assertLockEntryCount(projectRoot, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Remove a prompt → all output files deleted, lock entry removed
  // -------------------------------------------------------------------------

  describe('remove prompt', () => {
    it('removes all output files and lock entry for a canonical prompt', async () => {
      const content = makePromptContent('deploy', { body: 'Deploy steps.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'deploy', content);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Verify install
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'deploy'));
      }
      await assertLockEntry(projectRoot, 'prompt', 'deploy');

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['deploy'], { type: ['prompt'], yes: true });

      // Verify removal
      for (const agent of PROMPT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'deploy'));
      }
      await assertNoLockEntry(projectRoot, 'prompt', 'deploy');
      await assertLockEntryCount(projectRoot, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Remove an agent → all output files deleted, lock entry removed
  // -------------------------------------------------------------------------

  describe('remove agent', () => {
    it('removes all output files and lock entry for a canonical agent', async () => {
      const content = makeAgentContent('reviewer', { body: 'Review code.' });
      writeCanonicalFile(sourceRepo, 'agent', 'reviewer', content);

      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      // Verify install
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'reviewer'));
      }
      await assertLockEntry(projectRoot, 'agent', 'reviewer');

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['reviewer'], { type: ['agent'], yes: true });

      // Verify removal
      for (const agent of AGENT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'reviewer'));
      }
      await assertNoLockEntry(projectRoot, 'agent', 'reviewer');
      await assertLockEntryCount(projectRoot, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Remove non-existent item → graceful handling
  // -------------------------------------------------------------------------

  describe('remove non-existent item', () => {
    it('does not crash when removing an item that does not exist', async () => {
      // Install one rule so the lock file exists
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'existing',
        makeRuleContent('existing', { body: 'Content.' })
      );
      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 1);

      // Try to remove a non-existent item — should not crash
      process.chdir(projectRoot);
      await removeCommand(['nonexistent'], { type: ['rule'], yes: true });

      // The existing rule should still be intact
      await assertLockEntry(projectRoot, 'rule', 'existing');
      await assertLockEntryCount(projectRoot, 1);
    });

    it('does not crash when lock file does not exist', async () => {
      // No lock file exists — removeCommand should handle gracefully
      process.chdir(projectRoot);
      await removeCommand(['anything'], { type: ['rule'], yes: true });

      // Should not throw — just a no-op
    });
  });

  // -------------------------------------------------------------------------
  // Remove --all → cleans up all items of that type
  // -------------------------------------------------------------------------

  describe('remove --all', () => {
    it('removes all rules when --all is specified', async () => {
      // Install 3 rules
      writeCanonicalFile(sourceRepo, 'rule', 'r1', makeRuleContent('r1', { body: 'R1' }));
      writeCanonicalFile(sourceRepo, 'rule', 'r2', makeRuleContent('r2', { body: 'R2' }));
      writeCanonicalFile(sourceRepo, 'rule', 'r3', makeRuleContent('r3', { body: 'R3' }));

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 3);

      // Remove all rules
      process.chdir(projectRoot);
      await removeCommand([], { type: ['rule'], yes: true, all: true });

      // All output files gone
      for (const name of ['r1', 'r2', 'r3']) {
        for (const agent of ALL_AGENTS) {
          assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', name));
        }
        await assertNoLockEntry(projectRoot, 'rule', name);
      }
      await assertLockEntryCount(projectRoot, 0);
    });

    it('removes all items across types when --all + multiple types', async () => {
      // Install a rule and a prompt
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'my-rule',
        makeRuleContent('my-rule', { body: 'Rule.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'my-prompt',
        makePromptContent('my-prompt', { body: 'Prompt.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove all rules and prompts
      process.chdir(projectRoot);
      await removeCommand([], { type: ['rule', 'prompt'], yes: true, all: true });

      await assertNoLockEntry(projectRoot, 'rule', 'my-rule');
      await assertNoLockEntry(projectRoot, 'prompt', 'my-prompt');
      await assertLockEntryCount(projectRoot, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Remove with --type filter → only matching types removed
  // -------------------------------------------------------------------------

  describe('type filtering', () => {
    it('removes only rules when --type rule, leaving prompts intact', async () => {
      // Install a rule and a prompt
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'style',
        makeRuleContent('style', { body: 'Style guide.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'style',
        makePromptContent('style', { body: 'Style prompt.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove only rules named "style"
      process.chdir(projectRoot);
      await removeCommand(['style'], { type: ['rule'], yes: true });

      // Rule should be gone
      await assertNoLockEntry(projectRoot, 'rule', 'style');

      // Prompt should still exist
      await assertLockEntry(projectRoot, 'prompt', 'style');
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'style'));
      }
      await assertLockEntryCount(projectRoot, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Lock file state after removal
  // -------------------------------------------------------------------------

  describe('lock file integrity', () => {
    it('lock file has version and empty items array after all items removed', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'cleanup',
        makeRuleContent('cleanup', { body: 'Content.' })
      );
      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['cleanup'], { type: ['rule'], yes: true });

      // Lock file should still exist with valid structure
      const lock = await getLockFile(projectRoot);
      expect(lock.version).toBe(1);
      expect(lock.items).toEqual([]);
    });

    it('output files referenced by lock entry are all deleted', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'verify-outputs',
        makeRuleContent('verify-outputs', { body: 'Check outputs.' })
      );
      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Get lock entry to know exact output paths
      const entry = await assertLockEntry(projectRoot, 'rule', 'verify-outputs');
      expect(entry.outputs.length).toBeGreaterThan(0);

      // All output files should exist before removal
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(true);
      }

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['verify-outputs'], { type: ['rule'], yes: true });

      // All output files should be gone
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Case-insensitive name matching
  // -------------------------------------------------------------------------

  describe('name matching', () => {
    it('matches item names case-insensitively', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'my-rule',
        makeRuleContent('my-rule', { body: 'Content.' })
      );
      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      await assertLockEntry(projectRoot, 'rule', 'my-rule');

      // Remove with different casing
      process.chdir(projectRoot);
      await removeCommand(['MY-RULE'], { type: ['rule'], yes: true });

      await assertNoLockEntry(projectRoot, 'rule', 'my-rule');
      await assertLockEntryCount(projectRoot, 0);
    });
  });
});
