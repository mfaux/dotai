import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  createTempProject,
  cleanupProject,
  makePromptContent,
  makeAgentContent,
  writeCanonicalFile,
  assertFileExists,
  getExpectedOutputPath,
  assertLockEntry,
  assertLockEntryCount,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addPrompts, addAgents } from '../src/lib/install/index.ts';
import { checkContextUpdates, updateContext } from '../src/lib/install/index.ts';
import { computeContentHash } from '../src/lib/lock/index.ts';

// ---------------------------------------------------------------------------
// E2E Update Flow Tests
//
// These tests exercise the full lifecycle: install → modify source →
// check for updates → run update → verify new content and updated lock.
//
// Each test:
//   1. Creates a source repo with a canonical context file
//   2. Installs it via addPrompts/addAgents
//   3. Modifies the source file content
//   4. Runs checkContextUpdates to verify detection
//   5. Runs updateContext to apply the update
//   6. Verifies output file content and lock hash are updated
// ---------------------------------------------------------------------------

describe('E2E update flow', () => {
  let projectRoot: string;
  let sourceRepo: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-update-');
    sourceRepo = createTempProject('dotai-e2e-update-src-');
  });

  afterEach(() => {
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
  });

  // -------------------------------------------------------------------------
  // Prompt update flow
  // -------------------------------------------------------------------------

  describe('prompt update', () => {
    it('check detects changed content hash after source modification', async () => {
      // 1. Install a canonical prompt
      const originalContent = makePromptContent('code-style', {
        body: 'Use const over let.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Verify initial install
      const initialEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const initialHash = initialEntry.hash;

      // 2. Modify source content
      const updatedContent = makePromptContent('code-style', {
        body: 'Use const over let. Also prefer arrow functions.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', updatedContent);

      // 3. Check detects the update
      const checkResult = await checkContextUpdates(projectRoot);

      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.errors).toHaveLength(0);
      expect(checkResult.updates[0]!.entry.name).toBe('code-style');
      expect(checkResult.updates[0]!.currentHash).toBe(initialHash);
      expect(checkResult.updates[0]!.latestHash).toBe(computeContentHash(updatedContent));
      expect(checkResult.updates[0]!.latestHash).not.toBe(initialHash);
    });

    it('check reports no updates when source is unchanged', async () => {
      const content = makePromptContent('code-style', { body: 'Same content.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', content);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // No modification — check should find nothing
      const checkResult = await checkContextUpdates(projectRoot);

      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(0);
    });

    it('update replaces output files with new content and updates lock hash', async () => {
      // 1. Install
      const originalContent = makePromptContent('code-style', {
        body: 'Original prompt body.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const initialHash = initialEntry.hash;

      // 2. Modify source
      const updatedContent = makePromptContent('code-style', {
        body: 'Updated prompt body with new guidelines.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', updatedContent);

      // 3. Run update
      const updateResult = await updateContext(projectRoot);

      expect(updateResult.totalChecked).toBe(1);
      expect(updateResult.successCount).toBe(1);
      expect(updateResult.failCount).toBe(0);

      // 4. Verify output files contain new content
      for (const agent of PROMPT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
        assertFileExists(outputPath, 'Updated prompt body with new guidelines.');
      }

      // 5. Verify lock hash updated
      const updatedEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      expect(updatedEntry.hash).not.toBe(initialHash);
      expect(updatedEntry.hash).toBe(computeContentHash(updatedContent));
    });

    it('update preserves installedAt timestamp', async () => {
      const originalContent = makePromptContent('code-style', { body: 'Original.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const originalInstalledAt = initialEntry.installedAt;

      // Modify and update
      const updatedContent = makePromptContent('code-style', { body: 'Updated.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', updatedContent);

      await updateContext(projectRoot);

      const updatedEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      expect(updatedEntry.installedAt).toBe(originalInstalledAt);
    });

    it('update with multiple prompts only updates changed ones', async () => {
      // Install two prompts
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-a',
        makePromptContent('prompt-a', { body: 'Prompt A body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-b',
        makePromptContent('prompt-b', { body: 'Prompt B body.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialEntryA = await assertLockEntry(projectRoot, 'prompt', 'prompt-a');
      const initialEntryB = await assertLockEntry(projectRoot, 'prompt', 'prompt-b');

      // Only modify prompt-b
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-b',
        makePromptContent('prompt-b', { body: 'Prompt B UPDATED body.' })
      );

      // Check should only report prompt-b
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(2);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('prompt-b');

      // Update
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.successCount).toBe(1);

      // prompt-a hash should be unchanged
      const updatedEntryA = await assertLockEntry(projectRoot, 'prompt', 'prompt-a');
      expect(updatedEntryA.hash).toBe(initialEntryA.hash);

      // prompt-b hash should be different
      const updatedEntryB = await assertLockEntry(projectRoot, 'prompt', 'prompt-b');
      expect(updatedEntryB.hash).not.toBe(initialEntryB.hash);

      // prompt-b output should have new content
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'prompt-b'),
          'Prompt B UPDATED body.'
        );
      }
    });

    it('check detects changed prompt content', async () => {
      const originalContent = makePromptContent('review-code', {
        body: 'Review the code for bugs.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'review-code', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const initialHash = initialEntry.hash;

      // Modify
      const updatedContent = makePromptContent('review-code', {
        body: 'Review the code for bugs and security issues.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'review-code', updatedContent);

      // Check
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('review-code');
      expect(checkResult.updates[0]!.entry.type).toBe('prompt');
      expect(checkResult.updates[0]!.latestHash).not.toBe(initialHash);
    });

    it('update replaces prompt outputs and updates lock hash', async () => {
      const originalContent = makePromptContent('review-code', {
        body: 'Original prompt body.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'review-code', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const initialHash = initialEntry.hash;

      // Modify
      const updatedContent = makePromptContent('review-code', {
        body: 'Updated prompt with enhanced instructions.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'review-code', updatedContent);

      // Update
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.totalChecked).toBe(1);
      expect(updateResult.successCount).toBe(1);

      // Verify output files
      for (const agent of PROMPT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code');
        assertFileExists(outputPath, 'Updated prompt with enhanced instructions.');
      }

      // Verify lock hash updated
      const updatedEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      expect(updatedEntry.hash).not.toBe(initialHash);
      expect(updatedEntry.hash).toBe(computeContentHash(updatedContent));
    });
  });

  // -------------------------------------------------------------------------
  // Agent update flow
  // -------------------------------------------------------------------------

  describe('agent update', () => {
    it('check detects changed agent content', async () => {
      const originalContent = makeAgentContent('architect', {
        body: 'You are an architecture agent.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'architect', originalContent);

      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'agent', 'architect');
      const initialHash = initialEntry.hash;

      // Modify
      const updatedContent = makeAgentContent('architect', {
        body: 'You are an architecture agent. Focus on scalability.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'architect', updatedContent);

      // Check
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('architect');
      expect(checkResult.updates[0]!.entry.type).toBe('agent');
      expect(checkResult.updates[0]!.latestHash).not.toBe(initialHash);
    });

    it('update replaces agent outputs and updates lock hash', async () => {
      const originalContent = makeAgentContent('architect', {
        body: 'Original agent instructions.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'architect', originalContent);

      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'agent', 'architect');
      const initialHash = initialEntry.hash;

      // Modify
      const updatedContent = makeAgentContent('architect', {
        body: 'Updated agent with new capabilities.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'architect', updatedContent);

      // Update
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.totalChecked).toBe(1);
      expect(updateResult.successCount).toBe(1);

      // Verify output files
      for (const agent of AGENT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'agent', 'architect');
        assertFileExists(outputPath, 'Updated agent with new capabilities.');
      }

      // Verify lock hash updated
      const updatedEntry = await assertLockEntry(projectRoot, 'agent', 'architect');
      expect(updatedEntry.hash).not.toBe(initialHash);
      expect(updatedEntry.hash).toBe(computeContentHash(updatedContent));
    });
  });

  // -------------------------------------------------------------------------
  // Mixed type update flow
  // -------------------------------------------------------------------------

  describe('mixed type update', () => {
    it('check and update work across prompts and agents from same source', async () => {
      // Install both types
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'Style v1.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review v1.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Architect v1.' })
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

      await assertLockEntryCount(projectRoot, 3);

      // Save initial hashes
      const initialCodeStyle = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const initialPrompt = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const initialAgent = await assertLockEntry(projectRoot, 'agent', 'architect');

      // Modify all three
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'Style v2.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review v2.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Architect v2.' })
      );

      // Check detects all 3 updates
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(3);
      expect(checkResult.updates).toHaveLength(3);
      expect(checkResult.errors).toHaveLength(0);

      const updateNames = checkResult.updates.map((u) => u.entry.name).sort();
      expect(updateNames).toEqual(['architect', 'code-style', 'review-code']);

      // Update all
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.totalChecked).toBe(3);
      expect(updateResult.successCount).toBe(3);
      expect(updateResult.failCount).toBe(0);

      // Verify all hashes changed
      const updatedCodeStyle = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const updatedPrompt = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const updatedAgent = await assertLockEntry(projectRoot, 'agent', 'architect');

      expect(updatedCodeStyle.hash).not.toBe(initialCodeStyle.hash);
      expect(updatedPrompt.hash).not.toBe(initialPrompt.hash);
      expect(updatedAgent.hash).not.toBe(initialAgent.hash);

      // Verify output content
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style'),
          'Style v2.'
        );
      }
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code'),
          'Review v2.'
        );
      }
      for (const agent of AGENT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'agent', 'architect'),
          'Architect v2.'
        );
      }
    });

    it('partial updates only affect changed items', async () => {
      // Install two prompts
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'Style body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const initialCodeStyleEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      const initialPromptEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');

      // Only modify the review-code prompt
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body UPDATED.' })
      );

      // Check — only review-code should have update
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(2);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('review-code');
      expect(checkResult.updates[0]!.entry.type).toBe('prompt');

      // Update
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.successCount).toBe(1);

      // code-style hash unchanged
      const updatedCodeStyleEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style');
      expect(updatedCodeStyleEntry.hash).toBe(initialCodeStyleEntry.hash);

      // review-code hash changed
      const updatedPromptEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      expect(updatedPromptEntry.hash).not.toBe(initialPromptEntry.hash);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('check reports error when source item is removed from repo', async () => {
      // Install a prompt
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'Style body.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Replace with a different prompt (remove code-style, add different-prompt)
      const { rmSync } = await import('fs');
      rmSync(join(sourceRepo, 'prompts', 'code-style'), { recursive: true, force: true });
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'different-prompt',
        makePromptContent('different-prompt', { body: 'Different body.' })
      );

      // Check should report error for missing prompt
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(1);
      expect(checkResult.errors[0]!.entry.name).toBe('code-style');
      expect(checkResult.errors[0]!.error).toContain('no longer found');
    });

    it('second update after already-updated content reports no updates', async () => {
      // Install
      const originalContent = makePromptContent('code-style', { body: 'Original.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', originalContent);

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Modify and update
      const updatedContent = makePromptContent('code-style', { body: 'Updated.' });
      writeCanonicalFile(sourceRepo, 'prompt', 'code-style', updatedContent);

      await updateContext(projectRoot);

      // Second check — should find no updates
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(0);
    });

    it('update preserves lock entry count (no duplicates)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'v1.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 1);

      // Modify and update
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'v2.' })
      );

      await updateContext(projectRoot);

      // Still 1 entry, not 2
      await assertLockEntryCount(projectRoot, 1);
    });

    it('update outputs all agent files for a prompt (same as initial install)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'v1 body.' })
      );

      await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      // Modify and update
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', { body: 'v2 body.' })
      );

      await updateContext(projectRoot);

      // All prompt agents should have output files with new content
      const updatedEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style', {
        outputCount: PROMPT_AGENTS.length,
      });
      expect(updatedEntry.agents).toHaveLength(PROMPT_AGENTS.length);

      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style'),
          'v2 body.'
        );
      }
    });
  });
});
