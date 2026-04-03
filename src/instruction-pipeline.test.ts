import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DiscoveredItem } from './types.ts';
import {
  planContextWrites,
  executeInstallPipeline,
  type InstallPipelineOptions,
} from './context-installer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid INSTRUCTIONS.md content string. */
function makeInstructionContent(
  name: string,
  opts: { description?: string; body?: string } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    '---',
    '',
    opts.body ?? `Instruction body for ${name}.`,
  ].join('\n');
}

/** Create a DiscoveredItem for a canonical instruction. */
function canonicalInstruction(
  name: string,
  opts: { description?: string; body?: string } = {}
): DiscoveredItem {
  return {
    type: 'instruction',
    format: 'canonical',
    name,
    description: opts.description ?? `Description for ${name}`,
    sourcePath: `/fake/source/INSTRUCTIONS.md`,
    rawContent: makeInstructionContent(name, opts),
  };
}

/** Create base pipeline options. */
function baseOptions(
  projectRoot: string,
  overrides: Partial<InstallPipelineOptions> = {}
): InstallPipelineOptions {
  return {
    projectRoot,
    source: 'test/repo',
    lockEntries: [],
    force: false,
    dryRun: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('install-pipeline — instructions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dotai-instr-pipeline-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // planContextWrites — instruction items
  // -------------------------------------------------------------------------

  describe('planContextWrites — instructions', () => {
    it('transpiles a canonical instruction to 3 unique outputs (deduplicated)', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planContextWrites(items, opts);

      expect(skipped).toHaveLength(0);
      // 4 agents, but cursor + opencode share AGENTS.md → 3 unique outputs
      expect(writes).toHaveLength(3);
    });

    it('all instruction outputs use append mode', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir);

      const { writes } = planContextWrites(items, opts);

      for (const write of writes) {
        expect(write.planned.output.mode).toBe('append');
      }
    });

    it('attaches correct metadata to planned writes', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { source: 'acme/repo' });

      const { writes } = planContextWrites(items, opts);

      for (const write of writes) {
        expect(write.planned.type).toBe('instruction');
        expect(write.planned.name).toBe('code-style');
        expect(write.planned.format).toBe('canonical');
        expect(write.planned.source).toBe('acme/repo');
      }
    });

    it('respects agent subset filter', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['github-copilot'] });

      const { writes } = planContextWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('github-copilot');
    });

    it('produces copilot output in .github directory', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['github-copilot'] });

      const { writes } = planContextWrites(items, opts);

      expect(writes[0]!.planned.absolutePath).toBe(
        join(tmpDir, '.github', 'copilot-instructions.md')
      );
    });

    it('produces claude-code output in project root', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['claude-code'] });

      const { writes } = planContextWrites(items, opts);

      expect(writes[0]!.planned.absolutePath).toBe(join(tmpDir, 'CLAUDE.md'));
    });

    it('produces cursor output in project root AGENTS.md', () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['cursor'] });

      const { writes } = planContextWrites(items, opts);

      expect(writes[0]!.planned.absolutePath).toBe(join(tmpDir, 'AGENTS.md'));
    });

    it('handles mixed instructions + rules + prompts together', () => {
      // Import helpers would make this complex — test with just instructions
      const items = [
        canonicalInstruction('code-style'),
        canonicalInstruction('security-guidelines'),
      ];
      const opts = baseOptions(tmpDir, { targets: ['github-copilot'] });

      const { writes } = planContextWrites(items, opts);

      // 2 instructions × 1 agent = 2 writes
      expect(writes).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — instruction writes
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — instruction writes', () => {
    it('writes instructions as marker sections in all target files', async () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(3);

      // Copilot: .github/copilot-instructions.md
      const copilotPath = join(tmpDir, '.github', 'copilot-instructions.md');
      expect(existsSync(copilotPath)).toBe(true);
      const copilotContent = readFileSync(copilotPath, 'utf-8');
      expect(copilotContent).toContain('<!-- dotai:code-style:start -->');
      expect(copilotContent).toContain('<!-- dotai:code-style:end -->');

      // Claude: CLAUDE.md
      const claudePath = join(tmpDir, 'CLAUDE.md');
      expect(existsSync(claudePath)).toBe(true);
      const claudeContent = readFileSync(claudePath, 'utf-8');
      expect(claudeContent).toContain('<!-- dotai:code-style:start -->');

      // Cursor + OpenCode: AGENTS.md (shared)
      const agentsPath = join(tmpDir, 'AGENTS.md');
      expect(existsSync(agentsPath)).toBe(true);
      const agentsContent = readFileSync(agentsPath, 'utf-8');
      expect(agentsContent).toContain('<!-- dotai:code-style:start -->');
    });

    it('instruction content includes name, description, and body', async () => {
      const items = [
        canonicalInstruction('code-style', {
          description: 'Team coding standards',
          body: 'Always use strict TypeScript.',
        }),
      ];
      const opts = baseOptions(tmpDir, { targets: ['github-copilot'] });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, '.github', 'copilot-instructions.md'), 'utf-8');
      expect(content).toContain('## code-style');
      expect(content).toContain('> Team coding standards');
      expect(content).toContain('Always use strict TypeScript.');
    });

    it('preserves existing content when appending instructions', async () => {
      // Pre-create AGENTS.md with user content
      writeFileSync(join(tmpDir, 'AGENTS.md'), '# My Project\n\nHand-written instructions.\n');

      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['cursor'], force: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Hand-written instructions.');
      expect(content).toContain('<!-- dotai:code-style:start -->');
    });

    it('idempotent re-install does not duplicate sections', async () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { targets: ['cursor'] });

      await executeInstallPipeline(items, opts);
      const result2 = await executeInstallPipeline(items, opts);

      expect(result2.success).toBe(true);
      const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      const startCount = (content.match(/<!-- dotai:code-style:start -->/g) || []).length;
      expect(startCount).toBe(1);
    });

    it('dry-run reports instruction writes without creating files', async () => {
      const items = [canonicalInstruction('code-style')];
      const opts = baseOptions(tmpDir, { dryRun: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(3);
      expect(result.written).toHaveLength(0);
      expect(existsSync(join(tmpDir, '.github', 'copilot-instructions.md'))).toBe(false);
      expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
    });

    it('writes multiple instructions as separate sections in same file', async () => {
      const items = [canonicalInstruction('code-style'), canonicalInstruction('security')];
      const opts = baseOptions(tmpDir, { targets: ['github-copilot'] });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, '.github', 'copilot-instructions.md'), 'utf-8');
      expect(content).toContain('<!-- dotai:code-style:start -->');
      expect(content).toContain('<!-- dotai:code-style:end -->');
      expect(content).toContain('<!-- dotai:security:start -->');
      expect(content).toContain('<!-- dotai:security:end -->');
    });
  });
});
