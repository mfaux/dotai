import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
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
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addPrompts, addAgents } from '../src/lib/install/index.ts';
import { removeCommand } from '../src/remove.ts';
import { checkContextUpdates, updateContext } from '../src/lib/install/index.ts';
import { runCli } from '../src/lib/test-utils.ts';

// ---------------------------------------------------------------------------
// E2E CLI Matrix Tests
//
// Focused matrix suite exercising high-value CLI scenarios at the command
// entrypoint level. Covers:
//   1. add with --prompt, --custom-agent, and mixed --type
//   2. remove --type for non-skill contexts
//   3. list default + --type agent behavior
//   4. check/update messaging for non-skill lock entries
//   5. install overloaded routing (with/without args)
//   6. Onboarding scenario: shared command installs expected context
//
// Uses both pipeline-level calls (deterministic, no network) and CLI
// subprocess calls (for routing/output assertions).
// ---------------------------------------------------------------------------

describe('E2E CLI matrix: multi-type flows', () => {
  let projectRoot: string;
  let sourceRepo: string;
  let oldCwd: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-matrix-');
    sourceRepo = createTempProject('dotai-e2e-matrix-src-');
    oldCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(oldCwd);
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
  });

  // -------------------------------------------------------------------------
  // 1. add with --prompt, --custom-agent
  // -------------------------------------------------------------------------

  describe('add with individual type flags', () => {
    it('--prompt installs only prompts from a source with mixed types', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review the code.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'I help with code.' })
      );

      // Install only prompts
      const result = await addPrompts({
        source: 'team/shared-context',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);

      // Prompt files exist for supported agents
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'review'));
      }

      // Only prompt in lock, no agents
      await assertLockEntryCount(projectRoot, 1);
      await assertLockEntry(projectRoot, 'prompt', 'review');
    });

    it('--custom-agent installs only agents from a source with mixed types', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review the code.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'reviewer',
        makeAgentContent('reviewer', {
          description: 'Code review agent',
          body: 'You review code for quality.',
        })
      );

      // Install only agents
      const result = await addAgents({
        source: 'team/shared-context',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(1);

      // Agent files exist for supported agents
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'reviewer'));
      }

      // Only agent in lock, no prompts
      await assertLockEntryCount(projectRoot, 1);
      await assertLockEntry(projectRoot, 'agent', 'reviewer');
    });
  });

  // -------------------------------------------------------------------------
  // 2. add with mixed --type
  // -------------------------------------------------------------------------

  describe('add with mixed types', () => {
    it('installs prompts and agents from the same source in sequence', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'explain',
        makePromptContent('explain', { body: 'Explain the selected code.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'architect',
        makeAgentContent('architect', { body: 'Architecture planning.' })
      );

      // Simulate --type prompt,agent by running both flows
      const promptResult = await addPrompts({
        source: 'team/context',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(promptResult.success).toBe(true);

      const agentResult = await addAgents({
        source: 'team/context',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });
      expect(agentResult.success).toBe(true);

      // Prompt + agent installed
      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'explain');
      await assertLockEntry(projectRoot, 'agent', 'architect');
    });

    it('installs both prompts and agents from the same source', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'debug',
        makePromptContent('debug', { body: 'Help debug this issue.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'tester',
        makeAgentContent('tester', { body: 'You write and run tests.' })
      );

      // Install both types
      const promptResult = await addPrompts({
        source: 'team/full',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      const agentResult = await addAgents({
        source: 'team/full',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(promptResult.success).toBe(true);
      expect(agentResult.success).toBe(true);

      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'debug');
      await assertLockEntry(projectRoot, 'agent', 'tester');

      // Verify output files exist for each type's supported agents
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'debug'));
      }
      for (const agent of AGENT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'tester'));
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. remove --type for non-skill contexts
  // -------------------------------------------------------------------------

  describe('remove --type for non-skill contexts', () => {
    it('removes a prompt by name with --type prompt', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'deploy',
        makePromptContent('deploy', { body: 'Deploy steps.' })
      );
      await addPrompts({
        source: 'ops/prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      await assertLockEntry(projectRoot, 'prompt', 'deploy');

      process.chdir(projectRoot);
      await removeCommand(['deploy'], { type: ['prompt'], yes: true });

      await assertNoLockEntry(projectRoot, 'prompt', 'deploy');
      for (const agent of PROMPT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'deploy'));
      }
    });

    it('removes an agent by name with --type agent', async () => {
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'planner',
        makeAgentContent('planner', { body: 'Plan the work.' })
      );
      await addAgents({
        source: 'ops/agents',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });
      await assertLockEntry(projectRoot, 'agent', 'planner');

      process.chdir(projectRoot);
      await removeCommand(['planner'], { type: ['agent'], yes: true });

      await assertNoLockEntry(projectRoot, 'agent', 'planner');
      for (const agent of AGENT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'agent', 'planner'));
      }
    });

    it('--all --type agent removes all agents but keeps prompts intact', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'my-prompt',
        makePromptContent('my-prompt', { body: 'Prompt body.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'agent-a',
        makeAgentContent('agent-a', { body: 'Agent A.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'agent-b',
        makeAgentContent('agent-b', { body: 'Agent B.' })
      );

      await addPrompts({
        source: 'team/ctx',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      await addAgents({
        source: 'team/ctx',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      await assertLockEntryCount(projectRoot, 3);

      process.chdir(projectRoot);
      await removeCommand([], { type: ['agent'], yes: true, all: true });

      // Both agents gone
      await assertNoLockEntry(projectRoot, 'agent', 'agent-a');
      await assertNoLockEntry(projectRoot, 'agent', 'agent-b');

      // Prompt still present
      await assertLockEntry(projectRoot, 'prompt', 'my-prompt');
      await assertLockEntryCount(projectRoot, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. list default + --type agent behavior
  // -------------------------------------------------------------------------

  describe('list with --type agent', () => {
    it('list --type agent shows agents section', () => {
      // Write a lock file with an agent entry
      writeFileSync(
        join(projectRoot, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'agent',
              name: 'my-agent',
              source: 'team/agents',
              format: 'canonical',
              agents: ['github-copilot', 'claude-code'],
              hash: 'abc123',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list', '--type', 'agent'], projectRoot);
      expect(result.stdout).toContain('my-agent');
      expect(result.stdout).toContain('Agents');
      expect(result.stdout).not.toContain('Prompts');
      expect(result.stdout).not.toContain('Skills');
      expect(result.exitCode).toBe(0);
    });

    it('list --type agent shows empty state when no agents installed', () => {
      const result = runCli(['list', '--type', 'agent'], projectRoot);
      expect(result.stdout).toContain('No project agents found');
      expect(result.exitCode).toBe(0);
    });

    it('list shows all types by default when all are present', () => {
      // Create a skill
      const skillDir = join(projectRoot, '.agents', 'skills', 'my-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: my-skill
description: A test skill
---
# My Skill
`
      );

      // Create lock with prompt and agent
      writeFileSync(
        join(projectRoot, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'prompt',
              name: 'my-prompt',
              source: 'team/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'bbb',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'agent',
              name: 'my-agent',
              source: 'team/repo',
              format: 'canonical',
              agents: ['claude-code'],
              hash: 'ccc',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list'], projectRoot);
      expect(result.stdout).toContain('Skills');
      expect(result.stdout).toContain('my-skill');
      expect(result.stdout).toContain('Prompts');
      expect(result.stdout).toContain('my-prompt');
      expect(result.stdout).toContain('Agents');
      expect(result.stdout).toContain('my-agent');
      expect(result.exitCode).toBe(0);
    });

    it('list --type agent filters by agent with -a flag', () => {
      writeFileSync(
        join(projectRoot, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'agent',
              name: 'copilot-agent',
              source: 'team/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'aaa',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'agent',
              name: 'claude-agent',
              source: 'team/repo',
              format: 'canonical',
              agents: ['claude-code'],
              hash: 'bbb',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list', '--type', 'agent', '-a', 'github-copilot'], projectRoot);
      expect(result.stdout).toContain('copilot-agent');
      expect(result.stdout).not.toContain('claude-agent');
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. check/update messaging for non-skill lock entries
  // -------------------------------------------------------------------------

  describe('check/update for non-skill context', () => {
    it('check detects updates across both non-skill types', async () => {
      // Install prompt and agent
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review v1.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'Helper v1.' })
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

      // Modify both
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review v2.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'Helper v2.' })
      );

      // Check detects both
      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(2);
      expect(checkResult.updates).toHaveLength(2);
      expect(checkResult.errors).toHaveLength(0);

      const types = checkResult.updates.map((u) => u.entry.type).sort();
      expect(types).toEqual(['agent', 'prompt']);
    });

    it('update applies changes to both non-skill types', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review v1.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'Helper v1.' })
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

      // Save initial hashes
      const initialPrompt = await assertLockEntry(projectRoot, 'prompt', 'review');
      const initialAgent = await assertLockEntry(projectRoot, 'agent', 'helper');

      // Modify both
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', { body: 'Review v2.' })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'Helper v2.' })
      );

      // Update all
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.totalChecked).toBe(2);
      expect(updateResult.successCount).toBe(2);
      expect(updateResult.failCount).toBe(0);

      // Verify hashes changed
      const updatedPrompt = await assertLockEntry(projectRoot, 'prompt', 'review');
      const updatedAgent = await assertLockEntry(projectRoot, 'agent', 'helper');

      expect(updatedPrompt.hash).not.toBe(initialPrompt.hash);
      expect(updatedAgent.hash).not.toBe(initialAgent.hash);

      // Verify output content updated
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'review'),
          'Review v2.'
        );
      }
      for (const agent of AGENT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'agent', 'helper'),
          'Helper v2.'
        );
      }
    });

    it('check reports no updates when nothing changed', async () => {
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'helper',
        makeAgentContent('helper', { body: 'Stable agent.' })
      );

      await addAgents({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.totalChecked).toBe(1);
      expect(checkResult.updates).toHaveLength(0);
      expect(checkResult.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. install/restore command routing
  // -------------------------------------------------------------------------

  describe('install command routing', () => {
    it('install (no args) routes to add and shows missing source error', () => {
      const result = runCli(['install'], projectRoot);
      // install is now an alias of add, so no args shows source error
      expect(result.stdout).toContain('Missing required argument: source');
      expect(result.exitCode).toBe(1);
    });

    it('"i" alias routes the same as "install" (to add)', () => {
      const result = runCli(['i'], projectRoot);
      expect(result.stdout).toContain('Missing required argument: source');
      expect(result.exitCode).toBe(1);
    });

    it('"restore" routes to restore from lock files', () => {
      const result = runCli(['restore'], projectRoot);
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('"experimental_install" routes to restore', () => {
      const result = runCli(['experimental_install'], projectRoot);
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Onboarding scenario: shared command → successful install + output
  // -------------------------------------------------------------------------

  describe('onboarding: shared command installs expected context', () => {
    it('team-shared prompt install produces correct output files and lock', async () => {
      // Scenario: A developer shares "dotai add team/prompts --prompt code-style -y"
      // We simulate this at the pipeline level (deterministic, no network).

      // 1. Source repo has a prompt that a teammate created
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Team code style guidelines',
          body: 'Use 2-space indentation. Prefer const over let.',
        })
      );

      // 2. New developer runs the shared command (simulated via pipeline)
      const result = await addPrompts({
        source: 'team/shared-prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['code-style'],
      });

      // 3. Verify: install succeeded
      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);

      // 4. Verify: output files exist for supported agents
      for (const agent of PROMPT_AGENTS) {
        const outputPath = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
        assertFileExists(outputPath, 'Use 2-space indentation');
      }

      // 5. Verify: lock file is correct
      const lockEntry = await assertLockEntry(projectRoot, 'prompt', 'code-style', {
        source: 'team/shared-prompts',
        format: 'canonical',
      });
      expect(lockEntry.hash).toMatch(/^[a-f0-9]{64}$/);
      await assertLockEntryCount(projectRoot, 1);
    });

    it('team-shared prompt+agent install from same source produces correct output', async () => {
      // Scenario: "dotai add team/dx-tools --type prompt,agent -y"

      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review-pr',
        makePromptContent('review-pr', {
          description: 'Review a pull request',
          body: 'Analyze this PR for correctness and style.',
        })
      );
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'dx-helper',
        makeAgentContent('dx-helper', {
          description: 'Developer experience assistant',
          model: 'claude-sonnet-4',
          body: 'Help developers with DX questions.',
        })
      );

      // Install both types
      const promptResult = await addPrompts({
        source: 'team/dx-tools',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(promptResult.success).toBe(true);

      const agentResult = await addAgents({
        source: 'team/dx-tools',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });
      expect(agentResult.success).toBe(true);

      // Verify prompt outputs
      for (const agent of PROMPT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'prompt', 'review-pr'),
          'Analyze this PR'
        );
      }

      // Verify agent outputs
      for (const agent of AGENT_AGENTS) {
        assertFileExists(
          getExpectedOutputPath(projectRoot, agent, 'agent', 'dx-helper'),
          'Help developers with DX questions'
        );
      }

      // Lock file has both entries
      await assertLockEntryCount(projectRoot, 2);
      await assertLockEntry(projectRoot, 'prompt', 'review-pr', {
        source: 'team/dx-tools',
      });
      await assertLockEntry(projectRoot, 'agent', 'dx-helper', {
        source: 'team/dx-tools',
      });
    });

    it('full onboarding: install → list → update → remove lifecycle', async () => {
      // Complete lifecycle test

      // 1. Install a prompt
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'testing',
        makePromptContent('testing', {
          description: 'Testing guidelines',
          body: 'Write tests first. v1.',
        })
      );

      const installResult = await addPrompts({
        source: sourceRepo,
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(installResult.success).toBe(true);

      // 2. List shows the prompt
      const listResult = runCli(['list', '--type', 'prompt'], projectRoot);
      expect(listResult.stdout).toContain('testing');
      expect(listResult.stdout).toContain('Prompts');

      // 3. Modify source → check detects update
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'testing',
        makePromptContent('testing', {
          description: 'Testing guidelines',
          body: 'Write tests first. Always. v2.',
        })
      );

      const checkResult = await checkContextUpdates(projectRoot);
      expect(checkResult.updates).toHaveLength(1);
      expect(checkResult.updates[0]!.entry.name).toBe('testing');

      // 4. Update applies the change
      const updateResult = await updateContext(projectRoot);
      expect(updateResult.successCount).toBe(1);

      for (const agent of PROMPT_AGENTS) {
        assertFileExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'testing'), 'v2.');
      }

      // 5. Remove cleans up
      process.chdir(projectRoot);
      await removeCommand(['testing'], { type: ['prompt'], yes: true });

      await assertNoLockEntry(projectRoot, 'prompt', 'testing');
      await assertLockEntryCount(projectRoot, 0);

      for (const agent of PROMPT_AGENTS) {
        assertFileNotExists(getExpectedOutputPath(projectRoot, agent, 'prompt', 'testing'));
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. CLI help and messaging consistency
  // -------------------------------------------------------------------------

  describe('CLI help reflects type support', () => {
    it('add --help mentions supported content types', () => {
      const result = runCli(['add', '--help']);
      expect(result.stdout).toContain('skill');
      expect(result.stdout).toContain('prompt');
      expect(result.stdout).toContain('agent');
    });

    it('remove --help mentions --type option', () => {
      const result = runCli(['remove', '--help']);
      expect(result.stdout).toContain('--type');
      expect(result.stdout).toContain('skill');
      expect(result.stdout).toContain('prompt');
      expect(result.stdout).toContain('agent');
    });

    it('remove --help shows --type in options', () => {
      const result = runCli(['remove', '--help']);
      expect(result.stdout).toContain('-t, --type');
    });
  });
});
