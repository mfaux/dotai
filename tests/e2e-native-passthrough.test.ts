import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  createTempProject,
  cleanupProject,
  makeRuleContent,
  makePromptContent,
  makeAgentContent,
  writeCanonicalFile,
  writeNativeFile,
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
// E2E Native Passthrough Tests
//
// These tests verify that native (agent-specific) context files are discovered,
// passed through without transpilation, and installed only to their matching
// agent's output directory.
//
// Native passthrough means: a `.cursor/rules/foo.mdc` file in the source repo
// should be installed as-is to `.cursor/rules/foo.mdc` in the project, and
// NOT to any other agent's directory.
// ---------------------------------------------------------------------------

describe('E2E native passthrough', () => {
  let projectRoot: string;
  let sourceRepo: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-native-');
    sourceRepo = createTempProject('dotai-e2e-native-src-');
  });

  afterEach(() => {
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
  });

  // -------------------------------------------------------------------------
  // Native rule passthrough
  // -------------------------------------------------------------------------

  describe('native rule passthrough', () => {
    it('installs a native Cursor rule only to Cursor', async () => {
      const content = '---\nalwaysApply: true\n---\nNative Cursor rule content.';
      writeNativeFile(sourceRepo, 'rule', 'cursor', 'code-style.mdc', content);

      const result = await addRules({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(1);

      // Cursor should have the file
      const cursorOutput = getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style');
      assertFileExists(cursorOutput);
      const writtenContent = readFileSync(cursorOutput, 'utf-8');
      expect(writtenContent).toBe(content);

      // Other agents should NOT have the file
      for (const agent of ALL_AGENTS.filter((a) => a !== 'cursor')) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style'));
      }

      // Lock should reflect native format with only cursor
      const entry = await assertLockEntry(projectRoot, 'rule', 'code-style', {
        source: 'test/native-repo',
        format: 'native:cursor',
        agents: ['cursor'],
        outputCount: 1,
      });
      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('installs a native Copilot rule only to Copilot', async () => {
      const content = '---\napplyTo: "**/*.ts"\n---\nNative Copilot rule.';
      writeNativeFile(sourceRepo, 'rule', 'github-copilot', 'ts-rules.instructions.md', content);

      const result = await addRules({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.writtenPaths).toHaveLength(1);

      // Copilot should have the file
      const copilotOutput = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'rule',
        'ts-rules'
      );
      assertFileExists(copilotOutput);
      const writtenContent = readFileSync(copilotOutput, 'utf-8');
      expect(writtenContent).toBe(content);

      // Other agents should NOT have the file
      for (const agent of ALL_AGENTS.filter((a) => a !== 'github-copilot')) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'ts-rules'));
      }

      await assertLockEntry(projectRoot, 'rule', 'ts-rules', {
        format: 'native:github-copilot',
        agents: ['github-copilot'],
        outputCount: 1,
      });
    });

    it('installs a native Claude Code rule only to Claude Code', async () => {
      const content = 'Native Claude Code rule content.';
      writeNativeFile(sourceRepo, 'rule', 'claude-code', 'security.md', content);

      const result = await addRules({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.writtenPaths).toHaveLength(1);

      const claudeOutput = getExpectedOutputPath(projectRoot, 'claude-code', 'rule', 'security');
      assertFileExists(claudeOutput);
      expect(readFileSync(claudeOutput, 'utf-8')).toBe(content);

      // Other agents should NOT have it
      for (const agent of ALL_AGENTS.filter((a) => a !== 'claude-code')) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'security'));
      }

      await assertLockEntry(projectRoot, 'rule', 'security', {
        format: 'native:claude-code',
        agents: ['claude-code'],
        outputCount: 1,
      });
    });

    it('installs native rules from multiple agents independently', async () => {
      writeNativeFile(sourceRepo, 'rule', 'cursor', 'cursor-rule.mdc', 'Cursor native rule.');
      writeNativeFile(sourceRepo, 'rule', 'claude-code', 'claude-rule.md', 'Claude native rule.');

      const result = await addRules({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(2);
      expect(result.writtenPaths).toHaveLength(2);

      // Cursor rule only in cursor dir
      assertFileExists(getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'cursor-rule'));
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'claude-code', 'rule', 'cursor-rule'));

      // Claude rule only in claude dir
      assertFileExists(getExpectedOutputPath(projectRoot, 'claude-code', 'rule', 'claude-rule'));
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'claude-rule'));

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'rule', 'cursor-rule', {
        format: 'native:cursor',
        agents: ['cursor'],
      });
      await assertLockEntry(projectRoot, 'rule', 'claude-rule', {
        format: 'native:claude-code',
        agents: ['claude-code'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Native prompt passthrough
  // -------------------------------------------------------------------------

  describe('native prompt passthrough', () => {
    it('installs a native Copilot prompt only to Copilot', async () => {
      const content = '---\ndescription: Native deploy prompt\n---\nDeploy the app.';
      writeNativeFile(sourceRepo, 'prompt', 'github-copilot', 'deploy.prompt.md', content);

      const result = await addPrompts({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(1);

      // Copilot should have the file
      const copilotOutput = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'prompt',
        'deploy'
      );
      assertFileExists(copilotOutput);
      expect(readFileSync(copilotOutput, 'utf-8')).toBe(content);

      // Claude should NOT have the file
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'claude-code', 'prompt', 'deploy'));

      await assertLockEntry(projectRoot, 'prompt', 'deploy', {
        format: 'native:github-copilot',
        agents: ['github-copilot'],
        outputCount: 1,
      });
    });

    it('installs a native Claude Code prompt only to Claude Code', async () => {
      const content = 'Run the test suite and fix failures.';
      writeNativeFile(sourceRepo, 'prompt', 'claude-code', 'run-tests.md', content);

      const result = await addPrompts({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.writtenPaths).toHaveLength(1);

      const claudeOutput = getExpectedOutputPath(projectRoot, 'claude-code', 'prompt', 'run-tests');
      assertFileExists(claudeOutput);
      expect(readFileSync(claudeOutput, 'utf-8')).toBe(content);

      // Copilot should NOT have it
      assertFileNotExists(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'run-tests')
      );

      await assertLockEntry(projectRoot, 'prompt', 'run-tests', {
        format: 'native:claude-code',
        agents: ['claude-code'],
        outputCount: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Native agent passthrough
  // -------------------------------------------------------------------------

  describe('native agent passthrough', () => {
    it('installs a native Copilot agent only to Copilot', async () => {
      const content =
        '---\nname: "planner"\ndescription: "Plans tasks"\nmodel: "gpt-4o"\n---\nYou are a planner.';
      writeNativeFile(sourceRepo, 'agent', 'github-copilot', 'planner.agent.md', content);

      const result = await addAgents({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(1);

      // Copilot should have the file
      const copilotOutput = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'agent',
        'planner'
      );
      assertFileExists(copilotOutput);
      expect(readFileSync(copilotOutput, 'utf-8')).toBe(content);

      // Claude should NOT have the file
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'claude-code', 'agent', 'planner'));

      await assertLockEntry(projectRoot, 'agent', 'planner', {
        format: 'native:github-copilot',
        agents: ['github-copilot'],
        outputCount: 1,
      });
    });

    it('installs a native Claude Code agent only to Claude Code', async () => {
      const content = 'You are a code reviewer agent.';
      writeNativeFile(sourceRepo, 'agent', 'claude-code', 'reviewer.md', content);

      const result = await addAgents({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.writtenPaths).toHaveLength(1);

      const claudeOutput = getExpectedOutputPath(projectRoot, 'claude-code', 'agent', 'reviewer');
      assertFileExists(claudeOutput);
      expect(readFileSync(claudeOutput, 'utf-8')).toBe(content);

      // Copilot should NOT have it
      assertFileNotExists(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'agent', 'reviewer')
      );

      await assertLockEntry(projectRoot, 'agent', 'reviewer', {
        format: 'native:claude-code',
        agents: ['claude-code'],
        outputCount: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Mixed canonical + native in the same source repo
  // -------------------------------------------------------------------------

  describe('mixed canonical and native', () => {
    it('installs both canonical and native rules from the same repo', async () => {
      // Canonical rule → goes to all 5 agents
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'formatting',
        makeRuleContent('formatting', { body: 'Canonical formatting rule.' })
      );

      // Native Cursor rule → goes to cursor only
      writeNativeFile(
        sourceRepo,
        'rule',
        'cursor',
        'cursor-only.mdc',
        '---\nalwaysApply: true\n---\nCursor-only content.'
      );

      const result = await addRules({
        source: 'test/mixed-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(2);
      // canonical: 5 files + native: 1 file = 6 total
      expect(result.writtenPaths).toHaveLength(6);

      // Canonical rule should be in all agents
      for (const agent of ALL_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'formatting'));
      }

      // Native cursor rule should be in cursor only
      assertFileExists(getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'cursor-only'));
      for (const agent of ALL_AGENTS.filter((a) => a !== 'cursor')) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'rule', 'cursor-only'));
      }

      // Lock: 2 entries with different formats
      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'rule', 'formatting', {
        format: 'canonical',
        outputCount: 5,
      });
      await assertLockEntry(projectRoot, 'rule', 'cursor-only', {
        format: 'native:cursor',
        outputCount: 1,
      });
    });

    it('installs canonical prompts and native prompts from the same repo', async () => {
      // Canonical prompt → goes to copilot + claude
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-code',
        makePromptContent('review-code', { body: 'Canonical review prompt.' })
      );

      // Native Copilot prompt → goes to copilot only
      writeNativeFile(
        sourceRepo,
        'prompt',
        'github-copilot',
        'deploy.prompt.md',
        '---\ndescription: Deploy\n---\nDeploy steps.'
      );

      const result = await addPrompts({
        source: 'test/mixed-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(2);
      // canonical: 2 files + native: 1 file = 3 total
      expect(result.writtenPaths).toHaveLength(3);

      // Canonical prompt in copilot + claude
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-code'));
      }

      // Native Copilot prompt only in copilot
      assertFileExists(getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'deploy'));
      assertFileNotExists(getExpectedOutputPath(projectRoot, 'claude-code', 'prompt', 'deploy'));

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'review-code', { format: 'canonical' });
      await assertLockEntry(projectRoot, 'prompt', 'deploy', {
        format: 'native:github-copilot',
      });
    });

    it('installs canonical agents and native agents from the same repo', async () => {
      // Canonical agent → goes to copilot + claude
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Canonical architect agent.' })
      );

      // Native Claude agent → goes to claude only
      writeNativeFile(
        sourceRepo,
        'agent',
        'claude-code',
        'debugger.md',
        'You are a debugger agent.'
      );

      const result = await addAgents({
        source: 'test/mixed-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(2);
      // canonical: 2 files + native: 1 file = 3 total
      expect(result.writtenPaths).toHaveLength(3);

      // Canonical agent in copilot + claude
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'architect'));
      }

      // Native Claude agent only in claude
      assertFileExists(getExpectedOutputPath(projectRoot, 'claude-code', 'agent', 'debugger'));
      assertFileNotExists(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'agent', 'debugger')
      );

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'agent', 'architect', { format: 'canonical' });
      await assertLockEntry(projectRoot, 'agent', 'debugger', {
        format: 'native:claude-code',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Content is passed through unchanged
  // -------------------------------------------------------------------------

  describe('content passthrough fidelity', () => {
    it('native rule content is byte-identical to source', async () => {
      const content = [
        '---',
        'alwaysApply: false',
        'globs:',
        '  - "**/*.rs"',
        '---',
        '',
        '# Rust Guidelines',
        '',
        'Use `cargo fmt` before committing.',
        'Prefer `thiserror` over manual Error impls.',
        '',
      ].join('\n');

      writeNativeFile(sourceRepo, 'rule', 'cursor', 'rust-style.mdc', content);

      await addRules({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      const output = readFileSync(
        getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'rust-style'),
        'utf-8'
      );
      expect(output).toBe(content);
    });

    it('native prompt content is byte-identical to source', async () => {
      const content = [
        '---',
        'description: Explain code',
        'mode: ask',
        '---',
        '',
        'Explain the selected code in detail.',
      ].join('\n');

      writeNativeFile(sourceRepo, 'prompt', 'github-copilot', 'explain.prompt.md', content);

      await addPrompts({
        source: 'test/native-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      const output = readFileSync(
        getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'explain'),
        'utf-8'
      );
      expect(output).toBe(content);
    });
  });
});
