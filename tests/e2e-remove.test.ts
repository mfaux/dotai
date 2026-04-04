import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import {
  createTempProject,
  cleanupProject,
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
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addPrompts, addAgents } from '../src/lib/install/index.ts';
import { removeCommand } from '../src/remove.ts';

// ---------------------------------------------------------------------------
// E2E Remove Flow Tests
//
// These tests exercise the full lifecycle: install → remove → verify that
// all output files are deleted and lock entries are removed.
//
// Each test:
//   1. Creates a source repo with canonical context files
//   2. Installs them via addPrompts/addAgents
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

    it('removes only the named prompt when multiple prompts are installed', async () => {
      // Install two prompts
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-a',
        makePromptContent('prompt-a', { body: 'A' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-b',
        makePromptContent('prompt-b', { body: 'B' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove only prompt-a
      process.chdir(projectRoot);
      await removeCommand(['prompt-a'], { type: ['prompt'], yes: true });

      // prompt-a should be gone
      for (const agent of PROMPT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'prompt-a'));
      }
      await assertNoLockEntry(projectRoot, 'prompt', 'prompt-a');

      // prompt-b should still exist
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'prompt-b'));
      }
      await assertLockEntry(projectRoot, 'prompt', 'prompt-b');
      await assertLockEntryCount(projectRoot, 1);
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
      // Install one prompt so the lock file exists
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'existing',
        makePromptContent('existing', { body: 'Content.' })
      );
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 1);

      // Try to remove a non-existent item — should not crash
      process.chdir(projectRoot);
      await removeCommand(['nonexistent'], { type: ['prompt'], yes: true });

      // The existing prompt should still be intact
      await assertLockEntry(projectRoot, 'prompt', 'existing');
      await assertLockEntryCount(projectRoot, 1);
    });

    it('does not crash when lock file does not exist', async () => {
      // No lock file exists — removeCommand should handle gracefully
      process.chdir(projectRoot);
      await removeCommand(['anything'], { type: ['prompt'], yes: true });

      // Should not throw — just a no-op
    });
  });

  // -------------------------------------------------------------------------
  // Remove --all → cleans up all items of that type
  // -------------------------------------------------------------------------

  describe('remove --all', () => {
    it('removes all prompts when --all is specified', async () => {
      // Install 3 prompts
      writeCanonicalFile(sourceRepo, 'prompt', 'p1', makePromptContent('p1', { body: 'P1' }));
      writeCanonicalFile(sourceRepo, 'prompt', 'p2', makePromptContent('p2', { body: 'P2' }));
      writeCanonicalFile(sourceRepo, 'prompt', 'p3', makePromptContent('p3', { body: 'P3' }));

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 3);

      // Remove all prompts
      process.chdir(projectRoot);
      await removeCommand([], { type: ['prompt'], yes: true, all: true });

      // All output files gone
      for (const name of ['p1', 'p2', 'p3']) {
        for (const agent of PROMPT_AGENTS) {
          assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', name));
        }
        await assertNoLockEntry(projectRoot, 'prompt', name);
      }
      await assertLockEntryCount(projectRoot, 0);
    });

    it('removes all items across types when --all + multiple types', async () => {
      // Install a prompt and an agent
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'my-prompt',
        makePromptContent('my-prompt', { body: 'Prompt.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'my-agent',
        makeAgentContent('my-agent', { body: 'Agent.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove all prompts and agents
      process.chdir(projectRoot);
      await removeCommand([], { type: ['prompt', 'agent'], yes: true, all: true });

      await assertNoLockEntry(projectRoot, 'prompt', 'my-prompt');
      await assertNoLockEntry(projectRoot, 'agent', 'my-agent');
      await assertLockEntryCount(projectRoot, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Remove with --type filter → only matching types removed
  // -------------------------------------------------------------------------

  describe('type filtering', () => {
    it('removes only prompts when --type prompt, leaving agents intact', async () => {
      // Install a prompt and an agent with the same name
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'style',
        makePromptContent('style', { body: 'Style prompt.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'style',
        makeAgentContent('style', { body: 'Style agent.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 2);

      // Remove only prompts named "style"
      process.chdir(projectRoot);
      await removeCommand(['style'], { type: ['prompt'], yes: true });

      // Prompt should be gone
      await assertNoLockEntry(projectRoot, 'prompt', 'style');

      // Agent should still exist
      await assertLockEntry(projectRoot, 'agent', 'style');
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'style'));
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
        'prompt',
        'cleanup',
        makePromptContent('cleanup', { body: 'Content.' })
      );
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['cleanup'], { type: ['prompt'], yes: true });

      // Lock file should still exist with valid structure
      const lock = await getLockFile(projectRoot);
      expect(lock.version).toBe(1);
      expect(lock.items).toEqual([]);
    });

    it('output files referenced by lock entry are all deleted', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'verify-outputs',
        makePromptContent('verify-outputs', { body: 'Check outputs.' })
      );
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Get lock entry to know exact output paths
      const entry = await assertLockEntry(projectRoot, 'prompt', 'verify-outputs');
      expect(entry.outputs.length).toBeGreaterThan(0);

      // All output files should exist before removal
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(true);
      }

      // Remove
      process.chdir(projectRoot);
      await removeCommand(['verify-outputs'], { type: ['prompt'], yes: true });

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
        'prompt',
        'my-prompt',
        makePromptContent('my-prompt', { body: 'Content.' })
      );
      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntry(projectRoot, 'prompt', 'my-prompt');

      // Remove with different casing
      process.chdir(projectRoot);
      await removeCommand(['MY-PROMPT'], { type: ['prompt'], yes: true });

      await assertNoLockEntry(projectRoot, 'prompt', 'my-prompt');
      await assertLockEntryCount(projectRoot, 0);
    });
  });
});
