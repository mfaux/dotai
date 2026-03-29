import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  createTempProject,
  cleanupProject,
  makeRuleContent,
  makePromptContent,
  makeAgentContent,
  writeCanonicalFile,
  assertFileExists,
  getExpectedOutputPath,
  assertLockEntry,
  assertLockEntryCount,
  ALL_AGENTS,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addRules, addPrompts, addAgents } from '../src/rule-add.ts';
import { checkRuleUpdates, updateRules } from '../src/rule-check.ts';
import { computeContentHash } from '../src/dotai-lock.ts';

// ---------------------------------------------------------------------------
// E2E Update Flow Tests
//
// These tests exercise the full lifecycle: install → modify source →
// check for updates → run update → verify new content and updated lock.
//
// Each test:
//   1. Creates a source repo with a canonical context file
//   2. Installs it via addRules/addPrompts/addAgents
//   3. Modifies the source file content
//   4. Runs checkRuleUpdates to verify detection
//   5. Runs updateRules to apply the update
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
  // Rule update flow
  // -------------------------------------------------------------------------

  describe('rule update', () => {
    it('check detects changed content hash after source modification', async () => {
      // 1. Install a canonical rule
      const originalContent = makeRuleContent('code-style', {
        body: 'Use const over let.',
      });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', originalContent);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Verify initial install
      const initialEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const initialHash = initialEntry.hash;

      // 2. Modify source content
      const updatedContent = makeRuleContent('code-style', {
        body: 'Use const over let. Also prefer arrow functions.',
      });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', updatedContent);

      // 3. Check detects the update
      const checkResult = await checkRuleUpdates(projectRoot);

      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.errors).toHaveLength(0);
      expect(checkResult.updates[0]!.entry.name).toBe('code-style');
      expect(checkResult.updates[0]!.currentHash).toBe(initialHash);
      expect(checkResult.updates[0]!.latestHash).toBe(computeContentHash(updatedContent));
      expect(checkResult.updates[0]!.latestHash).not.toBe(initialHash);
    });

    it('check reports no updates when source is unchanged', async () => {
      const content = makeRuleContent('code-style', { body: 'Same content.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', content);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // No modification — check should find nothing
      const checkResult = await checkRuleUpdates(projectRoot);

      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(0);
    });

    it('update replaces output files with new content and updates lock hash', async () => {
      // 1. Install
      const originalContent = makeRuleContent('code-style', {
        body: 'Original rule body.',
      });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', originalContent);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const initialHash = initialEntry.hash;

      // 2. Modify source
      const updatedContent = makeRuleContent('code-style', {
        body: 'Updated rule body with new guidelines.',
      });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', updatedContent);

      // 3. Run update
      const updateResult = await updateRules(projectRoot);

      expect(updateResult.totalChecked).toBe(1);
      expect(updateResult.successCount).toBe(1);
      expect(updateResult.failCount).toBe(0);

      // 4. Verify output files contain new content
      for (const agent of ALL_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileExists(outputPath, 'Updated rule body with new guidelines.');
      }

      // 5. Verify lock hash updated
      const updatedEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      expect(updatedEntry.hash).not.toBe(initialHash);
      expect(updatedEntry.hash).toBe(computeContentHash(updatedContent));
    });

    it('update preserves installedAt timestamp', async () => {
      const originalContent = makeRuleContent('code-style', { body: 'Original.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', originalContent);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const initialEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const originalInstalledAt = initialEntry.installedAt;

      // Modify and update
      const updatedContent = makeRuleContent('code-style', { body: 'Updated.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', updatedContent);

      await updateRules(projectRoot);

      const updatedEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      expect(updatedEntry.installedAt).toBe(originalInstalledAt);
    });

    it('update with multiple rules only updates changed ones', async () => {
      // Install two rules
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'rule-a',
        makeRuleContent('rule-a', { body: 'Rule A body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'rule-b',
        makeRuleContent('rule-b', { body: 'Rule B body.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const initialEntryA = await assertLockEntry(projectRoot, 'rule', 'rule-a');
      const initialEntryB = await assertLockEntry(projectRoot, 'rule', 'rule-b');

      // Only modify rule-b
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'rule-b',
        makeRuleContent('rule-b', { body: 'Rule B UPDATED body.' })
      );

      // Check should only report rule-b
      const checkResult = await checkRuleUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(2);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('rule-b');

      // Update
      const updateResult = await updateRules(projectRoot);
      expect(updateResult.successCount).toBe(1);

      // rule-a hash should be unchanged
      const updatedEntryA = await assertLockEntry(projectRoot, 'rule', 'rule-a');
      expect(updatedEntryA.hash).toBe(initialEntryA.hash);

      // rule-b hash should be different
      const updatedEntryB = await assertLockEntry(projectRoot, 'rule', 'rule-b');
      expect(updatedEntryB.hash).not.toBe(initialEntryB.hash);

      // rule-b output should have new content
      for (const agent of ALL_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'rule', 'rule-b'),
          'Rule B UPDATED body.'
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Prompt update flow
  // -------------------------------------------------------------------------

  describe('prompt update', () => {
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
      const checkResult = await checkRuleUpdates(projectRoot);
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
      const updateResult = await updateRules(projectRoot);
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
      const checkResult = await checkRuleUpdates(projectRoot);
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
      const updateResult = await updateRules(projectRoot);
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
    it('check and update work across rules, prompts, and agents from same source', async () => {
      // Install all three types
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style v1.' })
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
      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 3);

      // Save initial hashes
      const initialRule = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const initialPrompt = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const initialAgent = await assertLockEntry(projectRoot, 'agent', 'architect');

      // Modify all three
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style v2.' })
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
      const checkResult = await checkRuleUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(3);
      expect(checkResult.updates).toHaveLength(3);
      expect(checkResult.errors).toHaveLength(0);

      const updateNames = checkResult.updates.map((u) => u.entry.name).sort();
      expect(updateNames).toEqual(['architect', 'code-style', 'review-code']);

      // Update all
      const updateResult = await updateRules(projectRoot);
      expect(updateResult.totalChecked).toBe(3);
      expect(updateResult.successCount).toBe(3);
      expect(updateResult.failCount).toBe(0);

      // Verify all hashes changed
      const updatedRule = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const updatedPrompt = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      const updatedAgent = await assertLockEntry(projectRoot, 'agent', 'architect');

      expect(updatedRule.hash).not.toBe(initialRule.hash);
      expect(updatedPrompt.hash).not.toBe(initialPrompt.hash);
      expect(updatedAgent.hash).not.toBe(initialAgent.hash);

      // Verify output content
      for (const agent of ALL_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'),
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
      // Install rule and prompt
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
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

      const initialRuleEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      const initialPromptEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');

      // Only modify the prompt
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body UPDATED.' })
      );

      // Check — only prompt should have update
      const checkResult = await checkRuleUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(2);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('review-code');
      expect(checkResult.updates[0]!.entry.type).toBe('prompt');

      // Update
      const updateResult = await updateRules(projectRoot);
      expect(updateResult.successCount).toBe(1);

      // Rule hash unchanged
      const updatedRuleEntry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      expect(updatedRuleEntry.hash).toBe(initialRuleEntry.hash);

      // Prompt hash changed
      const updatedPromptEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      expect(updatedPromptEntry.hash).not.toBe(initialPromptEntry.hash);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('check reports error when source item is removed from repo', async () => {
      // Install a rule
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Replace with a different rule (remove code-style, add different-rule)
      const { rmSync } = await import('fs');
      rmSync(join(sourceRepo, 'rules', 'code-style'), { recursive: true, force: true });
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'different-rule',
        makeRuleContent('different-rule', { body: 'Different body.' })
      );

      // Check should report error for missing rule
      const checkResult = await checkRuleUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(1);
      expect(checkResult.errors[0]!.entry.name).toBe('code-style');
      expect(checkResult.errors[0]!.error).toContain('no longer found');
    });

    it('second update after already-updated content reports no updates', async () => {
      // Install
      const originalContent = makeRuleContent('code-style', { body: 'Original.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', originalContent);

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Modify and update
      const updatedContent = makeRuleContent('code-style', { body: 'Updated.' });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', updatedContent);

      await updateRules(projectRoot);

      // Second check — should find no updates
      const checkResult = await checkRuleUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(0);
    });

    it('update preserves lock entry count (no duplicates)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'v1.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 1);

      // Modify and update
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'v2.' })
      );

      await updateRules(projectRoot);

      // Still 1 entry, not 2
      await assertLockEntryCount(projectRoot, 1);
    });

    it('update outputs all 4 agent files for a rule (same as initial install)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'v1 body.' })
      );

      await addRules({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Modify and update
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'v2 body.' })
      );

      await updateRules(projectRoot);

      // All 4 agents should have output files with new content
      const updatedEntry = await assertLockEntry(projectRoot, 'rule', 'code-style', {
        outputCount: 4,
      });
      expect(updatedEntry.agents).toHaveLength(4);

      for (const agent of ALL_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'),
          'v2 body.'
        );
      }
    });
  });
});
