import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
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
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addPrompts, addAgents } from '../src/context-add.ts';

// ---------------------------------------------------------------------------
// E2E Canonical Install Tests
//
// These tests exercise the full end-to-end flow for each canonical context
// type: discovery from a source repo -> transpilation -> file output to all
// target agents -> lock file update.
//
// Unlike unit tests that test individual functions, these tests create a
// real source repo with canonical files and a real project directory, then
// run the complete addPrompts/addAgents flow.
// ---------------------------------------------------------------------------

describe('E2E canonical install', () => {
  let projectRoot: string;
  let sourceRepo: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-canonical-');
    sourceRepo = createTempProject('dotai-e2e-source-');
  });

  afterEach(() => {
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
  });

  // -------------------------------------------------------------------------
  // Canonical prompt → Copilot + Claude + OpenCode → lock updated
  // -------------------------------------------------------------------------

  describe('canonical prompt install', () => {
    it('installs a canonical prompt to Copilot, Claude Code, and OpenCode and updates lock', async () => {
      const promptContent = makePromptContent('review-code', {
        description: 'Review code for issues',
        body: 'Review the code and identify potential issues.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'review-code', promptContent);

      const result = await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(3);

      // Verify output files for supported agents
      for (const agent of PROMPT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code');
        assertFileExists(outputPath);
      }

      // Copilot prompt format: YAML frontmatter with description
      const copilotContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'review-code'),
        'utf-8'
      );
      expect(copilotContent).toContain('description:');
      expect(copilotContent).toContain('Review the code and identify potential issues.');

      // Claude Code prompt format: blockquote description
      const claudeContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'claude-code', 'prompt', 'review-code'),
        'utf-8'
      );
      expect(claudeContent).toContain('>');
      expect(claudeContent).toContain('Review the code and identify potential issues.');

      // Agents that don't support prompts should have no output
      assertFileNotExists(join(projectRoot, '.cursor', 'prompts', 'review-code.mdc'));

      // Verify lock file
      const lockEntry = await assertLockEntry(projectRoot, 'prompt', 'review-code', {
        source: 'test/e2e-repo',
        format: 'canonical',
        outputCount: 3,
      });
      expect(lockEntry.hash).toBeTruthy();
      await assertLockEntryCount(projectRoot, 1);
    });

    it('installs a prompt with tools and agent fields', async () => {
      const promptContent = makePromptContent('deploy-check', {
        description: 'Pre-deployment checks',
        agent: 'plan',
        tools: ['Read', 'Grep'],
        body: 'Run pre-deployment verification.',
      });
      writeCanonicalFile(sourceRepo, 'prompt', 'deploy-check', promptContent);

      const result = await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);

      // Copilot should include tools and agent in frontmatter
      const copilotContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'deploy-check'),
        'utf-8'
      );
      expect(copilotContent).toContain('agent:');
      expect(copilotContent).toContain('tools:');
    });

    it('installs multiple prompts in one pass', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'explain-code',
        makePromptContent('explain-code', { body: 'Explain body.' })
      );

      const result = await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(2);
      // 2 prompts x 3 agents = 6 output files
      expect(result.writtenPaths).toHaveLength(6);

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'review-code');
      await assertLockEntry(projectRoot, 'prompt', 'explain-code');
    });
  });

  // -------------------------------------------------------------------------
  // Canonical agent → Copilot + Claude + OpenCode → lock updated
  // -------------------------------------------------------------------------

  describe('canonical agent install', () => {
    it('installs a canonical agent to Copilot, Claude Code, and OpenCode and updates lock', async () => {
      const agentContent = makeAgentContent('architect', {
        description: 'Architecture planning agent',
        model: 'claude-sonnet-4',
        tools: ['Read', 'Grep', 'Glob'],
        body: 'You are an architecture planning agent.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'architect', agentContent);

      const result = await addAgents({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(3);

      // Verify output files for supported agents
      for (const agent of AGENT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'agent', 'architect');
        assertFileExists(outputPath);
      }

      // Copilot agent format: YAML frontmatter
      const copilotContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'agent', 'architect'),
        'utf-8'
      );
      expect(copilotContent).toContain('name: "architect"');
      expect(copilotContent).toContain('description:');
      expect(copilotContent).toContain('model: "claude-sonnet-4"');
      expect(copilotContent).toContain('  - Read');
      expect(copilotContent).toContain('You are an architecture planning agent.');

      // Claude Code agent format: YAML frontmatter
      const claudeContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'claude-code', 'agent', 'architect'),
        'utf-8'
      );
      expect(claudeContent).toContain('name: "architect"');
      expect(claudeContent).toContain('description:');
      expect(claudeContent).toContain('You are an architecture planning agent.');

      // Verify lock file
      const lockEntry = await assertLockEntry(projectRoot, 'agent', 'architect', {
        source: 'test/e2e-repo',
        format: 'canonical',
        outputCount: 3,
      });
      expect(lockEntry.hash).toBeTruthy();
      await assertLockEntryCount(projectRoot, 1);
    });

    it('installs an agent with Claude Code-specific fields', async () => {
      const agentContent = makeAgentContent('reviewer', {
        description: 'Code review agent',
        tools: ['Read', 'Edit'],
        disallowedTools: ['Bash'],
        maxTurns: 15,
        background: false,
        body: 'You are a code review agent.',
      });
      writeCanonicalFile(sourceRepo, 'agent', 'reviewer', agentContent);

      const result = await addAgents({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);

      // Claude Code should include all special fields
      const claudeContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'claude-code', 'agent', 'reviewer'),
        'utf-8'
      );
      expect(claudeContent).toContain('disallowed-tools:');
      expect(claudeContent).toContain('  - Bash');
      expect(claudeContent).toContain('max-turns: 15');
      expect(claudeContent).toContain('background: false');
    });

    it('installs multiple agents in one pass', async () => {
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Architect body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'reviewer',
        makeAgentContent('reviewer', { body: 'Reviewer body.' })
      );

      const result = await addAgents({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(2);
      // 2 agents x 3 target agents = 6 output files
      expect(result.writtenPaths).toHaveLength(6);

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'agent', 'architect');
      await assertLockEntry(projectRoot, 'agent', 'reviewer');
    });
  });

  // -------------------------------------------------------------------------
  // Mixed context types in the same source repo
  // -------------------------------------------------------------------------

  describe('mixed canonical types', () => {
    it('installs prompts and agents from the same source repo', async () => {
      // Populate source repo with both context types
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review the code.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Architecture planning.' })
      );

      // Install both types sequentially
      const promptResult = await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(promptResult.success).toBe(true);

      const agentResult = await addAgents({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });
      expect(agentResult.success).toBe(true);

      // Verify all output files exist
      // Prompt: 3 agents
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code'));
      }
      // Agent: 3 agents
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'architect'));
      }

      // Lock file should have 2 entries (one per context item)
      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'review-code', { source: 'test/e2e-repo' });
      await assertLockEntry(projectRoot, 'agent', 'architect', { source: 'test/e2e-repo' });
    });
  });

  // -------------------------------------------------------------------------
  // Lock file content hash is populated
  // -------------------------------------------------------------------------

  describe('lock file content hash', () => {
    it('stores a non-empty hash for each installed item', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
      );

      await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const entry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      // Hash should be a SHA-256 hex string (64 chars)
      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different content produces different hashes', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-a',
        makePromptContent('prompt-a', { body: 'Content A.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'prompt-b',
        makePromptContent('prompt-b', { body: 'Content B.' })
      );

      await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const entryA = await assertLockEntry(projectRoot, 'prompt', 'prompt-a');
      const entryB = await assertLockEntry(projectRoot, 'prompt', 'prompt-b');
      expect(entryA.hash).not.toBe(entryB.hash);
    });
  });

  // -------------------------------------------------------------------------
  // Dry-run does not write files or lock
  // -------------------------------------------------------------------------

  describe('dry-run mode', () => {
    it('reports planned writes without creating files or updating lock', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
      );

      const result = await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);
      // No files written in dry-run
      expect(result.writtenPaths).toHaveLength(0);

      // No output files should exist
      for (const agent of PROMPT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code'));
      }

      // No lock file should be created
      expect(existsSync(join(projectRoot, '.dotai-lock.json'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Lock file output paths reference real files
  // -------------------------------------------------------------------------

  describe('lock output paths match real files', () => {
    it('every lock output path corresponds to a file on disk', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Review body.' })
      );

      await addPrompts({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const entry = await assertLockEntry(projectRoot, 'prompt', 'review-code');
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(true);
      }
    });
  });
});
