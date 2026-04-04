import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  writeUserFile,
  PROMPT_AGENTS,
  AGENT_AGENTS,
} from './e2e-utils.ts';
import { addPrompts, addAgents } from '../src/lib/install/index.ts';

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
    it('detects collision when user file exists at prompt target path (copilot)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style guidelines',
          body: 'Use consistent formatting.',
        })
      );

      // Pre-create a user-owned file at the Copilot output path
      const copilotPath = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'prompt',
        'code-style'
      );
      writeUserFile(copilotPath, 'my custom copilot prompts');

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

      // User file should still be intact
      expect(readFileSync(copilotPath, 'utf-8')).toBe('my custom copilot prompts');

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
    it('detects collision when prompt with same name is installed from different source (via addPrompts)', async () => {
      // Install a prompt from source 1
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'security',
        makePromptContent('security', {
          description: 'Security prompts v1',
          body: 'Original security prompts.',
        })
      );

      const firstResult = await addPrompts({
        source: 'team-a/prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(firstResult.success).toBe(true);
      expect(firstResult.promptsInstalled).toBe(1);

      // Try to install same-named prompt from source 2
      writeCanonicalFile(
        sourceRepo2,
        'prompt',
        'security',
        makePromptContent('security', {
          description: 'Security prompts v2',
          body: 'Different security prompts.',
        })
      );

      const secondResult = await addPrompts({
        source: 'team-b/prompts',
        sourcePath: sourceRepo2,
        projectRoot,
        promptNames: ['*'],
      });

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toBeDefined();
      expect(secondResult.error).toContain('collision');
      expect(secondResult.writtenPaths).toHaveLength(0);

      // Original files still contain v1 content
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'security');
        assertFileExists(path, 'Original security prompts.');
      }

      // Lock still references first source
      await assertLockEntry(projectRoot, 'prompt', 'security', {
        source: 'team-a/prompts',
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
    it('allows re-install of prompt from same source (treated as update)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style v1',
          body: 'Version 1.',
        })
      );

      const firstResult = await addPrompts({
        source: 'test/same-source',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(firstResult.success).toBe(true);

      // Modify content and re-install from the same source
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style v2',
          body: 'Version 2.',
        })
      );

      const secondResult = await addPrompts({
        source: 'test/same-source',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.promptsInstalled).toBe(1);

      // Files now contain v2 content
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
        assertFileExists(path, 'Version 2.');
      }

      await assertLockEntryCount(projectRoot, 1);
    });
  });

  // -------------------------------------------------------------------------
  // --force overrides collisions
  // -------------------------------------------------------------------------

  describe('--force overrides collisions', () => {
    it('force overwrites user-owned file at prompt target path (all agents)', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style guidelines',
          body: 'Dotai-managed style prompts.',
        })
      );

      // Pre-create user-owned files at ALL prompt agent paths
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
        writeUserFile(path, 'user-owned content');
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

      // All files now contain dotai-managed content
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
        assertFileExists(path, 'Dotai-managed style prompts.');
      }

      // Lock file created
      await assertLockEntry(projectRoot, 'prompt', 'code-style', {
        source: 'test/force-repo',
        format: 'canonical',
      });
    });

    it('force overwrites same-name prompt from different source', async () => {
      // Install from source 1
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'security',
        makePromptContent('security', {
          description: 'Security v1',
          body: 'Original prompts.',
        })
      );

      const firstResult = await addPrompts({
        source: 'team-a/prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(firstResult.success).toBe(true);

      // Force install same-named prompt from source 2
      writeCanonicalFile(
        sourceRepo2,
        'prompt',
        'security',
        makePromptContent('security', {
          description: 'Security v2',
          body: 'Replacement prompts.',
        })
      );

      const secondResult = await addPrompts({
        source: 'team-b/prompts',
        sourcePath: sourceRepo2,
        projectRoot,
        promptNames: ['*'],
        force: true,
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.promptsInstalled).toBe(1);

      // Files now contain v2 content
      for (const agent of PROMPT_AGENTS) {
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'security');
        assertFileExists(path, 'Replacement prompts.');
      }

      // Lock updated to new source
      await assertLockEntry(projectRoot, 'prompt', 'security', {
        source: 'team-b/prompts',
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
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style guidelines',
          body: 'Style prompts.',
        })
      );

      // Pre-create user-owned file at the Copilot output path
      const copilotPath = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'prompt',
        'code-style'
      );
      writeUserFile(copilotPath, 'user content');

      const result = await addPrompts({
        source: 'test/dryrun-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
        dryRun: true,
      });

      // Collision detected even in dry-run mode
      expect(result.success).toBe(false);
      expect(result.error).toContain('collision');
      expect(result.writtenPaths).toHaveLength(0);

      // User file still intact
      expect(readFileSync(copilotPath, 'utf-8')).toBe('user content');

      // No lock file created
      expect(existsSync(`${projectRoot}/.dotai-lock.json`)).toBe(false);
    });

    it('dry-run with --force reports planned writes without executing', async () => {
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'code-style',
        makePromptContent('code-style', {
          description: 'Code style guidelines',
          body: 'Style prompts.',
        })
      );

      // Pre-create user-owned file at the Copilot output path
      const copilotPath = getExpectedOutputPath(
        projectRoot,
        'github-copilot',
        'prompt',
        'code-style'
      );
      writeUserFile(copilotPath, 'user content');

      const result = await addPrompts({
        source: 'test/dryrun-force-repo',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
        dryRun: true,
        force: true,
      });

      // Force suppresses collision blocking, dry-run prevents writes
      expect(result.success).toBe(true);
      expect(result.promptsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(0); // dry-run = no files written

      // User file still intact (dry-run didn't overwrite)
      expect(readFileSync(copilotPath, 'utf-8')).toBe('user content');

      // No other agent files created
      for (const agent of PROMPT_AGENTS) {
        if (agent === 'github-copilot') continue; // user file exists
        const path = getExpectedOutputPath(projectRoot, agent, 'prompt', 'code-style');
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
    it('allows prompt and agent with same name from different sources', async () => {
      // Install a prompt named "review"
      writeCanonicalFile(
        sourceRepo,
        'prompt',
        'review',
        makePromptContent('review', {
          description: 'Review prompt',
          body: 'Review prompt body.',
        })
      );

      const promptResult = await addPrompts({
        source: 'team-a/prompts',
        sourcePath: sourceRepo,
        projectRoot,
        promptNames: ['*'],
      });
      expect(promptResult.success).toBe(true);

      // Install an agent named "review" from different source
      writeCanonicalFile(
        sourceRepo2,
        'agent',
        'review',
        makeAgentContent('review', {
          description: 'Review agent',
          body: 'Review agent body.',
        })
      );

      const agentResult = await addAgents({
        source: 'team-b/agents',
        sourcePath: sourceRepo2,
        projectRoot,
        agentNames: ['*'],
      });

      // No collision — different types have different output paths
      expect(agentResult.success).toBe(true);
      expect(agentResult.agentsInstalled).toBe(1);

      await assertLockEntry(projectRoot, 'prompt', 'review', {
        source: 'team-a/prompts',
      });
      await assertLockEntry(projectRoot, 'agent', 'review', {
        source: 'team-b/agents',
      });
      await assertLockEntryCount(projectRoot, 2);
    });
  });
});
