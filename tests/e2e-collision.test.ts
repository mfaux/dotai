import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
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
  assertNoLockEntry,
  writeUserFile,
  readOutputFile,
  ALL_AGENTS,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addRules, addPrompts, addAgents } from '../src/rule-add.ts';

// ---------------------------------------------------------------------------
// E2E Collision and Force Tests
//
// These tests exercise collision detection, --force override, and --dry-run
// interaction with collisions through the full end-to-end pipeline.
//
// Collision types tested:
// 1. User-owned file exists at target path → collision error
// 2. Same-name item from different source → collision error
// 3. --force overwrites collisions
// 4. --dry-run reports collisions without writing
// ---------------------------------------------------------------------------

describe('E2E collision tests', () => {
  let projectRoot: string;
  let sourceRepo: string;
  let sourceRepo2: string;

  beforeEach(() => {
    projectRoot = createTempProject('dotai-e2e-collision-');
    sourceRepo = createTempProject('dotai-e2e-collision-src-');
    sourceRepo2 = createTempProject('dotai-e2e-collision-src2-');
  });

  afterEach(() => {
    cleanupProject(projectRoot);
    cleanupProject(sourceRepo);
    cleanupProject(sourceRepo2);
  });

  // -------------------------------------------------------------------------
  // User-owned file collision
  // -------------------------------------------------------------------------

  describe('user-owned file collision', () => {
    it('detects collision when user file exists at rule target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style guidelines',
          activation: 'always',
          body: 'Use consistent formatting.',
        })
      );

      // Pre-create a user-owned file at the Cursor output path
      const cursorPath = getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style');
      writeUserFile(cursorPath, 'my custom cursor rules');

      const result = await addRules({
        source: 'test/collision-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('collision');
      expect(result.writtenPaths).toHaveLength(0);

      // User file should still be intact
      expect(readFileSync(cursorPath, 'utf-8')).toBe('my custom cursor rules');

      // No lock file created
      expect(existsSync(`${projectRoot}/.dotai-lock.json`)).toBe(false);
    });

    it('detects collision when user file exists at prompt target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'deploy',
        makePromptContent('deploy', {
          description: 'Deploy workflow',
          body: 'Run deployment steps.',
        })
      );

      // Pre-create a user-owned file at the Copilot prompt output path
      const copilotPath = getExpectedOutputPath(projectRoot, 'github-copilot', 'prompt', 'deploy');
      writeUserFile(copilotPath, 'my deploy prompt');

      const result = await addPrompts({
        source: 'test/collision-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('collision');
      expect(result.writtenPaths).toHaveLength(0);

      // User file intact
      expect(readFileSync(copilotPath, 'utf-8')).toBe('my deploy prompt');
    });

    it('detects collision when user file exists at agent target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'reviewer',
        makeAgentContent('reviewer', {
          description: 'Code reviewer agent',
          body: 'Review code thoroughly.',
        })
      );

      // Pre-create a user-owned file at the Copilot agent output path
      const copilotPath = getExpectedOutputPath(projectRoot, 'github-copilot', 'agent', 'reviewer');
      writeUserFile(copilotPath, 'my reviewer agent');

      const result = await addAgents({
        source: 'test/collision-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('collision');
      expect(result.writtenPaths).toHaveLength(0);

      // User file intact
      expect(readFileSync(copilotPath, 'utf-8')).toBe('my reviewer agent');
    });
  });

  // -------------------------------------------------------------------------
  // Same-name collision from different source
  // -------------------------------------------------------------------------

  describe('same-name collision from different source', () => {
    it('detects collision when rule with same name is installed from different source', async () => {
      // Install a rule from source 1
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'security',
        makeRuleContent('security', {
          description: 'Security rules v1',
          activation: 'always',
          body: 'Original security rules.',
        })
      );

      const firstResult = await addRules({
        source: 'team-a/rules',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      expect(firstResult.success).toBe(true);
      expect(firstResult.rulesInstalled).toBe(1);

      // Try to install same-named rule from source 2
      writeCanonicalFile(
        sourceRepo2,
        'rule',
        'security',
        makeRuleContent('security', {
          description: 'Security rules v2',
          activation: 'always',
          body: 'Different security rules.',
        })
      );

      const secondResult = await addRules({
        source: 'team-b/rules',
        sourcePath: sourceRepo2,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toBeDefined();
      expect(secondResult.error).toContain('collision');
      expect(secondResult.writtenPaths).toHaveLength(0);

      // Original files still contain v1 content
      for (const agent of ALL_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'security');
        assertFileExists(path, 'Original security rules.');
      }

      // Lock still references first source
      await assertLockEntry(projectRoot, 'rule', 'security', {
        source: 'team-a/rules',
      });
      await assertLockEntryCount(projectRoot, 1);
    });

    it('detects collision when prompt with same name is installed from different source', async () => {
      // Install a prompt from source 1
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', {
          description: 'Review workflow v1',
          body: 'Original review prompt.',
        })
      );

      const firstResult = await addPrompts({
        source: 'team-a/prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(firstResult.success).toBe(true);

      // Try to install same-named prompt from source 2
      writeCanonicalFile(
        sourceRepo2,
        'prompt',
        'review',
        makePromptContent('review', {
          description: 'Review workflow v2',
          body: 'Different review prompt.',
        })
      );

      const secondResult = await addPrompts({
        source: 'team-b/prompts',
        sourcePath: sourceRepo2,
        projectRoot,
        promptNames: ['*'],
      });

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('collision');
      expect(secondResult.writtenPaths).toHaveLength(0);

      // Lock still references first source
      await assertLockEntry(projectRoot, 'prompt', 'review', {
        source: 'team-a/prompts',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Re-install from same source is NOT a collision (update scenario)
  // -------------------------------------------------------------------------

  describe('re-install from same source', () => {
    it('allows re-install of rule from same source (treated as update)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style v1',
          activation: 'always',
          body: 'Version 1.',
        })
      );

      const firstResult = await addRules({
        source: 'test/same-source',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      expect(firstResult.success).toBe(true);

      // Modify content and re-install from the same source
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style v2',
          activation: 'always',
          body: 'Version 2.',
        })
      );

      const secondResult = await addRules({
        source: 'test/same-source',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.rulesInstalled).toBe(1);

      // Files now contain v2 content
      for (const agent of ALL_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileExists(path, 'Version 2.');
      }

      await assertLockEntryCount(projectRoot, 1);
    });
  });

  // -------------------------------------------------------------------------
  // --force overrides collisions
  // -------------------------------------------------------------------------

  describe('--force overrides collisions', () => {
    it('force overwrites user-owned file at rule target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style guidelines',
          activation: 'always',
          body: 'Dotai-managed style rules.',
        })
      );

      // Pre-create user-owned files at ALL agent paths
      for (const agent of ALL_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        writeUserFile(path, 'user-owned content');
      }

      const result = await addRules({
        source: 'test/force-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(5);

      // All files now contain dotai-managed content
      for (const agent of ALL_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileExists(path, 'Dotai-managed style rules.');
      }

      // Lock file created
      await assertLockEntry(projectRoot, 'rule', 'code-style', {
        source: 'test/force-repo',
        format: 'canonical',
        outputCount: 5,
      });
    });

    it('force overwrites same-name rule from different source', async () => {
      // Install from source 1
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'security',
        makeRuleContent('security', {
          description: 'Security v1',
          activation: 'always',
          body: 'Original rules.',
        })
      );

      const firstResult = await addRules({
        source: 'team-a/rules',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      expect(firstResult.success).toBe(true);

      // Force install same-named rule from source 2
      writeCanonicalFile(
        sourceRepo2,
        'rule',
        'security',
        makeRuleContent('security', {
          description: 'Security v2',
          activation: 'always',
          body: 'Replacement rules.',
        })
      );

      const secondResult = await addRules({
        source: 'team-b/rules',
        sourcePath: sourceRepo2,
        projectRoot,
        ruleNames: ['*'],
        force: true,
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.rulesInstalled).toBe(1);

      // Files now contain v2 content
      for (const agent of ALL_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'security');
        assertFileExists(path, 'Replacement rules.');
      }

      // Lock updated to new source
      await assertLockEntry(projectRoot, 'rule', 'security', {
        source: 'team-b/rules',
      });
    });

    it('force overwrites user-owned file at prompt target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'deploy',
        makePromptContent('deploy', {
          description: 'Deploy workflow',
          body: 'Automated deployment steps.',
        })
      );

      // Pre-create user-owned files at prompt agent paths
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'deploy');
        writeUserFile(path, 'my custom prompt');
      }

      const result = await addPrompts({
        source: 'test/force-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);

      // Files now contain dotai-managed content
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'deploy');
        assertFileExists(path, 'Automated deployment steps.');
      }

      await assertLockEntry(projectRoot, 'prompt', 'deploy', {
        source: 'test/force-repo',
      });
    });

    it('force overwrites user-owned file at agent target path', async () => {
      writeCanonicalFile(
        sourceRepo,
        'agent',
        'reviewer',
        makeAgentContent('reviewer', {
          description: 'Code reviewer',
          body: 'Review all changes carefully.',
        })
      );

      // Pre-create user-owned files at agent target paths
      for (const agent of AGENT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'agent', 'reviewer');
        writeUserFile(path, 'my custom agent');
      }

      const result = await addAgents({
        source: 'test/force-repo',
        sourcePath: sourceRepo,
        projectRoot,
        agentNames: ['*'],
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.agentsInstalled).toBe(1);

      // Files now contain dotai-managed content
      for (const agent of AGENT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'agent', 'reviewer');
        assertFileExists(path, 'Review all changes carefully.');
      }

      await assertLockEntry(projectRoot, 'agent', 'reviewer', {
        source: 'test/force-repo',
      });
    });
  });

  // -------------------------------------------------------------------------
  // --dry-run interaction with collisions
  // -------------------------------------------------------------------------

  describe('--dry-run with collisions', () => {
    it('dry-run reports collision without writing files', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style guidelines',
          activation: 'always',
          body: 'Style rules.',
        })
      );

      // Pre-create user-owned file
      const cursorPath = getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style');
      writeUserFile(cursorPath, 'user content');

      const result = await addRules({
        source: 'test/dryrun-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
        dryRun: true,
      });

      // Collision detected even in dry-run mode
      expect(result.success).toBe(false);
      expect(result.error).toContain('collision');
      expect(result.writtenPaths).toHaveLength(0);

      // User file still intact
      expect(readFileSync(cursorPath, 'utf-8')).toBe('user content');

      // No lock file created
      expect(existsSync(`${projectRoot}/.dotai-lock.json`)).toBe(false);
    });

    it('dry-run with --force reports planned writes without executing', async () => {
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'code-style',
        makeRuleContent('code-style', {
          description: 'Code style guidelines',
          activation: 'always',
          body: 'Style rules.',
        })
      );

      // Pre-create user-owned file
      const cursorPath = getExpectedOutputPath(projectRoot, 'cursor', 'rule', 'code-style');
      writeUserFile(cursorPath, 'user content');

      const result = await addRules({
        source: 'test/dryrun-force-repo',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
        dryRun: true,
        force: true,
      });

      // Force suppresses collision blocking, dry-run prevents writes
      expect(result.success).toBe(true);
      expect(result.rulesInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(0); // dry-run = no files written

      // User file still intact (dry-run didn't overwrite)
      expect(readFileSync(cursorPath, 'utf-8')).toBe('user content');

      // No other agent files created
      for (const agent of ALL_AGENTS) {
        if (agent === 'cursor') continue; // user file exists
        const path = getExpectedOutputPath(projectRoot, agent, 'rule', 'code-style');
        assertFileNotExists(path);
      }

      // No lock file created
      expect(existsSync(`${projectRoot}/.dotai-lock.json`)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // No collision for different context types with same name
  // -------------------------------------------------------------------------

  describe('no collision for different types with same name', () => {
    it('allows rule and prompt with same name from different sources', async () => {
      // Install a rule named "review"
      writeCanonicalFile(
        sourceRepo,
        'rule',
        'review',
        makeRuleContent('review', {
          description: 'Review rule',
          activation: 'always',
          body: 'Review rule body.',
        })
      );

      const ruleResult = await addRules({
        source: 'team-a/rules',
        sourcePath: sourceRepo,
        projectRoot,
        ruleNames: ['*'],
      });
      expect(ruleResult.success).toBe(true);

      // Install a prompt named "review" from different source
      writeCanonicalFile(
        sourceRepo2,
        'prompt',
        'review',
        makePromptContent('review', {
          description: 'Review prompt',
          body: 'Review prompt body.',
        })
      );

      const promptResult = await addPrompts({
        source: 'team-b/prompts',
        sourcePath: sourceRepo2,
        projectRoot,
        promptNames: ['*'],
      });

      // No collision — different types have different output paths
      expect(promptResult.success).toBe(true);
      expect(promptResult.promptsInstalled).toBe(1);

      await assertLockEntry(projectRoot, 'rule', 'review', {
        source: 'team-a/rules',
      });
      await assertLockEntry(projectRoot, 'prompt', 'review', {
        source: 'team-b/prompts',
      });
      await assertLockEntryCount(projectRoot, 2);
    });
  });
});
