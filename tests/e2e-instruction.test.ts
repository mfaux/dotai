import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { addInstructions } from '../src/lib/install/index.ts';
import type { TargetAgent } from '../src/lib/types.ts';
import {
  createTempProjectDir,
  createTestSourceRepo,
  readLockFileFromDisk,
  makeSimpleInstructionContent,
} from './e2e-utils.ts';

// ---------------------------------------------------------------------------
// addInstructions — end-to-end instruction install pipeline tests
//
// These tests exercise the full flow: discover INSTRUCTIONS.md → transpile
// to marker sections → write to target files → update lock file.
//
// Test plan requirements from plan.md:
// 1. Canonical INSTRUCTIONS.md → correct marker sections in target files
// 2. Coexistence with existing file content (hand-written content preserved)
// 3. Idempotent re-install (running add twice doesn't duplicate content)
// 4. Lock file updated with type: 'instruction' entry
// 5. --type instruction filter works (tested via addInstructions directly)
// 6. Dry-run mode plans but doesn't write
// ---------------------------------------------------------------------------

describe('addInstructions — e2e', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir('e2e-instr-'));
  });

  afterEach(async () => {
    await cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. Canonical INSTRUCTIONS.md → marker sections in target files
  // -------------------------------------------------------------------------

  describe('canonical instruction transpilation', () => {
    it('installs instruction as marker sections in all target files', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [
          {
            name: 'coding-standards',
            description: 'Team coding standards',
            body: 'Use TypeScript strict mode.',
          },
        ],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
      });

      expect(result.success).toBe(true);
      expect(result.instructionsInstalled).toBe(1);

      // Copilot: .github/copilot-instructions.md (append mode)
      const copilotPath = join(projectDir, '.github', 'copilot-instructions.md');
      expect(existsSync(copilotPath)).toBe(true);
      const copilotContent = readFileSync(copilotPath, 'utf-8');
      expect(copilotContent).toContain('<!-- dotai:coding-standards:start -->');
      expect(copilotContent).toContain('<!-- dotai:coding-standards:end -->');
      expect(copilotContent).toContain('Use TypeScript strict mode.');

      // Claude Code: CLAUDE.md (append mode)
      const claudePath = join(projectDir, 'CLAUDE.md');
      expect(existsSync(claudePath)).toBe(true);
      const claudeContent = readFileSync(claudePath, 'utf-8');
      expect(claudeContent).toContain('<!-- dotai:coding-standards:start -->');
      expect(claudeContent).toContain('<!-- dotai:coding-standards:end -->');
      expect(claudeContent).toContain('Use TypeScript strict mode.');

      // Cursor + OpenCode: AGENTS.md (shared, deduplicated)
      const agentsPath = join(projectDir, 'AGENTS.md');
      expect(existsSync(agentsPath)).toBe(true);
      const agentsContent = readFileSync(agentsPath, 'utf-8');
      expect(agentsContent).toContain('<!-- dotai:coding-standards:start -->');
      expect(agentsContent).toContain('<!-- dotai:coding-standards:end -->');
      expect(agentsContent).toContain('Use TypeScript strict mode.');
    });

    it('marker sections contain instruction name and description', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [
          {
            name: 'code-review',
            description: 'Code review guidelines',
            body: 'Always review PRs.',
          },
        ],
        'instruction'
      );

      await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
      });

      const copilotContent = readFileSync(
        join(projectDir, '.github', 'copilot-instructions.md'),
        'utf-8'
      );
      expect(copilotContent).toContain('## code-review');
      expect(copilotContent).toContain('> Code review guidelines');
      expect(copilotContent).toContain('Always review PRs.');
    });

    it('respects --targets filter for instruction install', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        targets: ['github-copilot'],
      });

      expect(result.success).toBe(true);

      // Copilot output should exist
      expect(existsSync(join(projectDir, '.github', 'copilot-instructions.md'))).toBe(true);

      // Other targets should NOT exist
      expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Coexistence with existing file content
  // -------------------------------------------------------------------------

  describe('coexistence with existing content', () => {
    it('preserves hand-written AGENTS.md content when appending instruction', async () => {
      // Pre-create AGENTS.md with user content
      writeFileSync(
        join(projectDir, 'AGENTS.md'),
        '# My Project\n\nThese are my custom instructions.\n'
      );

      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'team-standards', description: 'Team standards', body: 'Use ESLint.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        targets: ['cursor'],
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(projectDir, 'AGENTS.md'), 'utf-8');
      // Original content preserved
      expect(content).toContain('# My Project');
      expect(content).toContain('These are my custom instructions.');
      // New instruction appended
      expect(content).toContain('<!-- dotai:team-standards:start -->');
      expect(content).toContain('Use ESLint.');
      expect(content).toContain('<!-- dotai:team-standards:end -->');
    });

    it('preserves hand-written CLAUDE.md content', async () => {
      writeFileSync(join(projectDir, 'CLAUDE.md'), '# Claude Guidelines\n\nBe helpful.\n');

      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'guidelines', description: 'Guidelines', body: 'Follow guidelines.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        targets: ['claude-code'],
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(projectDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain('# Claude Guidelines');
      expect(content).toContain('Be helpful.');
      expect(content).toContain('<!-- dotai:guidelines:start -->');
    });

    it('preserves existing copilot-instructions.md content', async () => {
      mkdirSync(join(projectDir, '.github'), { recursive: true });
      writeFileSync(
        join(projectDir, '.github', 'copilot-instructions.md'),
        'Existing Copilot instructions.\n'
      );

      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'new-rules', description: 'New rules', body: 'New content.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        targets: ['github-copilot'],
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(projectDir, '.github', 'copilot-instructions.md'), 'utf-8');
      expect(content).toContain('Existing Copilot instructions.');
      expect(content).toContain('<!-- dotai:new-rules:start -->');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Idempotent re-install
  // -------------------------------------------------------------------------

  describe('idempotent re-install', () => {
    it('running add twice does not duplicate marker sections', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const opts = {
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'] as string[],
        targets: ['cursor'] as TargetAgent[],
      };

      // First install
      const result1 = await addInstructions(opts);
      expect(result1.success).toBe(true);

      // Second install (same content)
      const result2 = await addInstructions(opts);
      expect(result2.success).toBe(true);
      const content2 = readFileSync(join(projectDir, 'AGENTS.md'), 'utf-8');

      // Should have exactly one marker section, not two
      const startCount = (content2.match(/<!-- dotai:standards:start -->/g) || []).length;
      expect(startCount).toBe(1);

      const endCount = (content2.match(/<!-- dotai:standards:end -->/g) || []).length;
      expect(endCount).toBe(1);
    });

    it('idempotent across all target files', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'coding-rules', description: 'Rules', body: 'Follow rules.' }],
        'instruction'
      );

      const opts = {
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'] as string[],
      };

      await addInstructions(opts);
      await addInstructions(opts);

      // Check each file has exactly one section
      for (const filePath of [
        join(projectDir, '.github', 'copilot-instructions.md'),
        join(projectDir, 'CLAUDE.md'),
        join(projectDir, 'AGENTS.md'),
      ]) {
        const content = readFileSync(filePath, 'utf-8');
        const startCount = (content.match(/<!-- dotai:coding-rules:start -->/g) || []).length;
        expect(startCount).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Lock file updated with type: 'instruction' entry
  // -------------------------------------------------------------------------

  describe('lock file integration', () => {
    it('creates .dotai-lock.json with instruction entry', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'coding-standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
      });

      expect(result.success).toBe(true);

      // Verify lock file was created
      expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

      const lock = await readLockFileFromDisk(projectDir);
      expect(lock.version).toBe(1);
      expect(lock.items).toHaveLength(1);

      const entry = lock.items[0]!;
      expect(entry.type).toBe('instruction');
      expect(entry.name).toBe('coding-standards');
      expect(entry.source).toBe('test/repo');
      expect(entry.format).toBe('canonical');
      expect(entry.hash).toBeTruthy();
      expect(entry.installedAt).toBeTruthy();
      expect(entry.append).toBe(true);
    });

    it('lock entry records correct agents', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Standards body.' }],
        'instruction'
      );

      await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        targets: ['github-copilot', 'claude-code'],
      });

      const lock = await readLockFileFromDisk(projectDir);
      const entry = lock.items[0]!;
      expect(entry.agents).toContain('github-copilot');
      expect(entry.agents).toContain('claude-code');
    });

    it('lock entry output paths match written files', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'rules', description: 'Rules', body: 'Follow rules.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
      });

      const lock = await readLockFileFromDisk(projectDir);
      const entry = lock.items[0]!;

      // Every output path should exist on disk
      for (const outputPath of entry.outputs) {
        expect(existsSync(outputPath)).toBe(true);
      }

      // Output paths should match written paths
      expect(new Set(entry.outputs)).toEqual(new Set(result.writtenPaths));
    });

    it('re-install updates lock entry without duplication', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const opts = {
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'] as string[],
      };

      await addInstructions(opts);
      await addInstructions(opts);

      const lock = await readLockFileFromDisk(projectDir);
      // Should still have exactly one entry, not two
      const instructionEntries = lock.items.filter((e) => e.type === 'instruction');
      expect(instructionEntries).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. --type instruction filter (via instructionNames param)
  // -------------------------------------------------------------------------

  describe('instruction name filtering', () => {
    it('returns error when no instructions found in source', async () => {
      // Create empty source repo (no INSTRUCTIONS.md)
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'code-style', description: 'Style', body: 'Use const.' }],
        'prompt' // Create prompts, not instructions
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
      });

      expect(result.success).toBe(false);
      expect(result.instructionsInstalled).toBe(0);
      expect(result.error).toContain('No instructions found');
    });

    it('installs only matching instruction by name', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'coding-standards', description: 'Standards', body: 'Standards content.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['coding-standards'],
      });

      expect(result.success).toBe(true);
      expect(result.instructionsInstalled).toBe(1);
    });

    it('returns error when filtering by non-existent instruction name', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'coding-standards', description: 'Standards', body: 'Standards content.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['nonexistent-instruction'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No matching instructions');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Dry-run mode
  // -------------------------------------------------------------------------

  describe('dry-run mode', () => {
    it('plans writes without creating files', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.instructionsInstalled).toBe(1);
      expect(result.writtenPaths).toHaveLength(0);

      // No files should exist on disk
      expect(existsSync(join(projectDir, '.github', 'copilot-instructions.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    });

    it('dry-run does not create lock file', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        dryRun: true,
      });

      expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
    });

    it('dry-run messages include planned write paths', async () => {
      const sourceRepo = await createTestSourceRepo(
        tempDir,
        [{ name: 'standards', description: 'Standards', body: 'Follow standards.' }],
        'instruction'
      );

      const result = await addInstructions({
        source: 'test/repo',
        sourcePath: sourceRepo,
        projectRoot: projectDir,
        instructionNames: ['*'],
        dryRun: true,
      });

      // Messages should mention planned paths
      const allMessages = result.messages.join('\n');
      expect(allMessages).toContain('Would write');
    });
  });
});
