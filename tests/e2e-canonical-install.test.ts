import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
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
  ALL_AGENTS,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addRules, addPrompts, addAgents } from '../src/rule-add.ts';
import type { TargetAgent } from '../src/types.ts';

// ---------------------------------------------------------------------------
// E2E Canonical Install Tests
//
// These tests exercise the full end-to-end flow for each canonical context
// type: discovery from a source repo -> transpilation -> file output to all
// target agents -> lock file update.
//
// Unlike unit tests that test individual functions, these tests create a
// real source repo with canonical files and a real project directory, then
// run the complete addRules/addPrompts/addAgents flow.
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
  // Canonical rule → all 6 agents → lock updated
  // -------------------------------------------------------------------------

  describe('canonical rule install', () => {
    it('installs a canonical rule to all 6 agents and updates lock', async () => {
      // Create a canonical rule in the source repo
      const ruleContent = makeRuleContent('code-style', {
        description: 'Code style guidelines',
        activation: 'always',
        body: 'Use consistent formatting.',
      });
      writeCanonicalFile(sourceRepo, 'rule', 'code-style', ruleContent);

      // Run the full install flow
      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      // Verify success
      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(6);

      // Verify output files exist for all 6 agents
      for (const agent of ALL_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileExists(outputPath);
      }

      // Verify agent-specific content format
      // Cursor: .mdc with alwaysApply frontmatter
      const cursorContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style'),
        'utf-8'
      );
      expect(cursorContent).toContain('alwaysApply: true');
      expect(cursorContent).toContain('Use consistent formatting.');

      // Copilot: .instructions.md with applyTo frontmatter
      const copilotContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'rule', 'code-style'),
        'utf-8'
      );
      expect(copilotContent).toContain('applyTo:');
      expect(copilotContent).toContain('Use consistent formatting.');

      // Claude Code: plain .md
      const claudeContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'claude-code', 'rule', 'code-style'),
        'utf-8'
      );
      expect(claudeContent).toContain('Use consistent formatting.');

      // Verify lock file
      const lockEntry = await assertLockEntry(projectRoot, 'rule', 'code-style', {
        source: 'test/e2e-repo',
        format: 'canonical',
        outputCount: 6,
      });
      expect(lockEntry.agents).toHaveLength(6);
      expect(lockEntry.hash).toBeTruthy();
      await assertLockEntryCount(projectRoot, 1);
    });

    it('installs multiple canonical rules in one pass', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style rule body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'security',
        makeRuleContent('security', { body: 'Security rule body.' })
      );

      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(2);
      // 2 rules x 6 agents = 12 output files
      expect(result.writtenPaths).toHaveLength(12);

      // Both rules should have output files for all agents
      for (const agent of ALL_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'));
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'security'));
      }

      // Lock file should have 2 entries
      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'rule', 'code-style');
      await assertLockEntry(projectRoot, 'rule', 'security');
    });

    it('installs a rule with glob activation', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'ts-style',
        makeRuleContent('ts-style', {
          activation: 'glob',
          globs: ['**/*.ts', '**/*.tsx'],
          body: 'TypeScript style guidelines.',
        })
      );

      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);

      // Cursor output should have glob-specific frontmatter
      const cursorContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'ts-style'),
        'utf-8'
      );
      expect(cursorContent).toContain('alwaysApply: false');
      expect(cursorContent).toContain('**/*.ts');

      // Copilot output should have glob in applyTo
      const copilotContent = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'rule', 'ts-style'),
        'utf-8'
      );
      expect(copilotContent).toContain('**/*.ts');
    });

    it('installs a rule to a subset of agents', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );

      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
        agents: ['cursor', 'cline'],
      });

      expect(result.success).toBe(true);
      expect(result.writtenPaths).toHaveLength(2);

      // Only cursor and cline should have output files
      assertFileExists(getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style'));
      assertFileExists(getExpectedOutputPath(projectRoot, 'cline', 'rule', 'code-style'));

      // Others should NOT exist
      assertFileNotExists(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'rule', 'code-style')
      );
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'claude-code', 'rule', 'code-style'));
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'windsurf', 'rule', 'code-style'));

      // Lock entry should reflect only the 2 agents
      const lockEntry = await assertLockEntry(projectRoot, 'rule', 'code-style', {
        outputCount: 2,
      });
      expect(lockEntry.agents.sort()).toEqual(['cline', 'cursor']);
    });

    it('filters rules by name', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'security',
        makeRuleContent('security', { body: 'Security body.' })
      );

      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['security'],
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);

      // Only security should be installed
      for (const agent of ALL_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'security'));
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'));
      }

      await assertLockEntryCount(projectRoot, 1);
      await assertLockEntry(projectRoot, 'rule', 'security');
    });
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
      assertFileNotExists(join(projectRoot, '.clinerules', 'review-code.md'));

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
    it('installs rules, prompts, and agents from the same source repo', async () => {
      // Populate source repo with all three context types
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style guidelines.' })
      );
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

      // Install all three types sequentially
      const ruleResult = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      expect(ruleResult.success).toBe(true);

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
      // Rule: 6 agents
      for (const agent of ALL_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'));
      }
      // Prompt: 3 agents
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code'));
      }
      // Agent: 3 agents
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'architect'));
      }

      // Lock file should have 3 entries (one per context item)
      await assertLockEntryCount(projectRoot, 3);
      await assertLockEntry(projectRoot, 'rule', 'code-style', { source: 'test/e2e-repo' });
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
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );

      await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const entry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      // Hash should be a SHA-256 hex string (64 chars)
      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different content produces different hashes', async () => {
      // Install first rule
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'rule-a',
        makeRuleContent('rule-a', { body: 'Content A.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'rule-b',
        makeRuleContent('rule-b', { body: 'Content B.' })
      );

      await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const entryA = await assertLockEntry(projectRoot, 'rule', 'rule-a');
      const entryB = await assertLockEntry(projectRoot, 'rule', 'rule-b');
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
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );

      const result = await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);
      // No files written in dry-run
      expect(result.writtenPaths).toHaveLength(0);

      // No output files should exist
      for (const agent of ALL_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'));
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
        'rule',
        'code-style',
        makeRuleContent('code-style', { body: 'Style body.' })
      );

      await addRules({
        source: 'test/e2e-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const entry = await assertLockEntry(projectRoot, 'rule', 'code-style');
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(true);
      }
    });
  });
});
