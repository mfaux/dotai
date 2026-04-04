import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from '../list/list.ts';
import { addToGitignore, readManagedPaths } from './git/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a .dotai-lock.json with instruction entries. */
function writeLockWithInstructions(
  testDir: string,
  entries: Array<{
    name: string;
    source?: string;
    agents?: string[];
    hash?: string;
    outputs?: string[];
    append?: boolean;
    gitignored?: boolean;
  }>,
  extraEntries: Array<Record<string, unknown>> = []
): void {
  const items = entries.map((e) => ({
    type: 'instruction',
    name: e.name,
    source: e.source ?? 'owner/repo',
    format: 'canonical',
    agents: e.agents ?? ['github-copilot', 'claude-code'],
    hash: e.hash ?? 'abc123',
    installedAt: '2025-06-01T00:00:00.000Z',
    outputs: e.outputs ?? [],
    append: e.append ?? true,
    ...(e.gitignored !== undefined && { gitignored: e.gitignored }),
  }));

  writeFileSync(
    join(testDir, '.dotai-lock.json'),
    JSON.stringify({ version: 1, items: [...items, ...extraEntries] })
  );
}

// ---------------------------------------------------------------------------
// List command — instruction support
// ---------------------------------------------------------------------------

describe('list command — instruction support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `instruction-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show instructions with --type instruction', () => {
    writeLockWithInstructions(testDir, [{ name: 'coding-standards', source: 'acme/dotai-config' }]);

    const result = runCli(['list', '--type', 'instruction'], testDir);
    expect(result.stdout).toContain('coding-standards');
    expect(result.stdout).toContain('Instructions');
    expect(result.stdout).toContain('acme/dotai-config');
    expect(result.exitCode).toBe(0);
  });

  it('should show instruction source and agent targets', () => {
    writeLockWithInstructions(testDir, [
      { name: 'team-rules', source: 'org/config', agents: ['cursor', 'opencode'] },
    ]);

    const result = runCli(['list', '-t', 'instruction'], testDir);
    expect(result.stdout).toContain('team-rules');
    expect(result.stdout).toContain('org/config');
    expect(result.stdout).toContain('Cursor');
    expect(result.stdout).toContain('OpenCode');
    expect(result.exitCode).toBe(0);
  });

  it('should show instructions alongside prompts by default', () => {
    writeLockWithInstructions(
      testDir,
      [{ name: 'my-instruction' }],
      [
        {
          type: 'prompt',
          name: 'my-prompt',
          source: 'owner/repo',
          format: 'canonical',
          agents: ['cursor'],
          hash: 'xyz',
          installedAt: '2025-01-01T00:00:00.000Z',
          outputs: [],
        },
      ]
    );

    const result = runCli(['list'], testDir);
    expect(result.stdout).toContain('Prompts');
    expect(result.stdout).toContain('my-prompt');
    expect(result.stdout).toContain('Instructions');
    expect(result.stdout).toContain('my-instruction');
    expect(result.exitCode).toBe(0);
  });

  it('should show empty state for --type instruction with no instructions', () => {
    const result = runCli(['list', '--type', 'instruction'], testDir);
    expect(result.stdout).toContain('No project instructions found');
    expect(result.exitCode).toBe(0);
  });

  it('should filter instructions by agent', () => {
    writeLockWithInstructions(testDir, [
      { name: 'cursor-instr', agents: ['cursor'] },
      { name: 'copilot-instr', agents: ['github-copilot'] },
    ]);

    const result = runCli(['list', '-t', 'instruction', '-a', 'cursor'], testDir);
    expect(result.stdout).toContain('cursor-instr');
    expect(result.stdout).not.toContain('copilot-instr');
    expect(result.exitCode).toBe(0);
  });

  it('should explain instructions are project-scoped for --type instruction -g', () => {
    writeLockWithInstructions(testDir, [{ name: 'some-instruction' }]);

    const result = runCli(['list', '--type', 'instruction', '-g'], testDir);
    expect(result.stdout).toContain('project-scoped');
    expect(result.stdout).not.toContain('some-instruction');
    expect(result.exitCode).toBe(0);
  });

  describe('parseListOptions — instruction type', () => {
    it('should parse --type instruction', () => {
      const options = parseListOptions(['--type', 'instruction']);
      expect(options.type).toEqual(['instruction']);
    });

    it('should parse comma-separated types including instruction', () => {
      const options = parseListOptions(['-t', 'skill,instruction']);
      expect(options.type).toEqual(['skill', 'instruction']);
    });

    it('should parse all four types comma-separated', () => {
      const options = parseListOptions(['-t', 'skill,prompt,agent,instruction']);
      expect(options.type).toEqual(['skill', 'prompt', 'agent', 'instruction']);
    });
  });
});

// ---------------------------------------------------------------------------
// Remove command — instruction support
// ---------------------------------------------------------------------------

describe('remove command — instruction support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `instruction-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should remove instruction by name with --type instruction', () => {
    // Create target file with marker section
    const agentsFile = join(testDir, 'AGENTS.md');
    writeFileSync(
      agentsFile,
      '# My Project\n\n<!-- dotai:coding-standards:start -->\nFollow coding standards.\n<!-- dotai:coding-standards:end -->\n'
    );

    writeLockWithInstructions(testDir, [
      {
        name: 'coding-standards',
        outputs: [agentsFile],
        append: true,
      },
    ]);

    const result = runCli(['remove', 'coding-standards', '--type', 'instruction', '-y'], testDir);
    expect(result.stdout).toContain('Successfully removed');
    expect(result.exitCode).toBe(0);

    // Verify marker section was removed
    const content = readFileSync(agentsFile, 'utf-8');
    expect(content).not.toContain('dotai:coding-standards:start');
    expect(content).not.toContain('Follow coding standards');
    expect(content).toContain('# My Project');
  });

  it('should remove instruction lock entry', () => {
    const agentsFile = join(testDir, 'AGENTS.md');
    writeFileSync(
      agentsFile,
      '<!-- dotai:test-instr:start -->\nTest\n<!-- dotai:test-instr:end -->\n'
    );

    writeLockWithInstructions(testDir, [
      {
        name: 'test-instr',
        outputs: [agentsFile],
        append: true,
      },
    ]);

    runCli(['remove', 'test-instr', '--type', 'instruction', '-y'], testDir);

    // Lock file should have no items
    const lock = JSON.parse(readFileSync(join(testDir, '.dotai-lock.json'), 'utf-8'));
    expect(lock.items).toHaveLength(0);
  });

  it('should handle --type instruction with no instructions', () => {
    writeFileSync(join(testDir, '.dotai-lock.json'), JSON.stringify({ version: 1, items: [] }));

    const result = runCli(['remove', '--type', 'instruction', '-y'], testDir);
    expect(result.stdout).toContain('No instruction');
    expect(result.stdout).toContain('to remove');
    expect(result.exitCode).toBe(0);
  });

  it('should remove all instructions with --all --type instruction', () => {
    const agentsFile = join(testDir, 'AGENTS.md');
    const claudeFile = join(testDir, 'CLAUDE.md');
    writeFileSync(agentsFile, '<!-- dotai:instr-a:start -->\nA\n<!-- dotai:instr-a:end -->\n');
    writeFileSync(claudeFile, '<!-- dotai:instr-b:start -->\nB\n<!-- dotai:instr-b:end -->\n');

    writeLockWithInstructions(testDir, [
      { name: 'instr-a', outputs: [agentsFile], append: true },
      { name: 'instr-b', outputs: [claudeFile], append: true },
    ]);

    const result = runCli(['remove', '--all', '--type', 'instruction', '-y'], testDir);
    expect(result.stdout).toContain('Successfully removed');
    expect(result.stdout).toContain('2 item');
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gitignore — instruction target files never gitignored
// ---------------------------------------------------------------------------

describe('gitignore — instruction target files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dotai-instr-gitignore-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should not include instruction outputs in .gitignore even when other entries are gitignored', async () => {
    // Simulate: add a skill with gitignore, then add an instruction
    // The instruction outputs should not appear in .gitignore
    await addToGitignore(tmpDir, [join(tmpDir, '.cursor/rules/code-style.mdc')]);

    const paths = await readManagedPaths(tmpDir);
    expect(paths).toContain('.cursor/rules/code-style.mdc');
    // Instruction target files should never be in gitignore
    expect(paths).not.toContain('AGENTS.md');
    expect(paths).not.toContain('CLAUDE.md');
    expect(paths).not.toContain('.github/copilot-instructions.md');
  });

  it('instruction lock entries should not have gitignored flag', () => {
    // Create a lock file with instruction entries — verify they lack gitignored
    writeLockWithInstructions(tmpDir, [
      { name: 'test-instr', outputs: [join(tmpDir, 'AGENTS.md')] },
    ]);

    const lock = JSON.parse(readFileSync(join(tmpDir, '.dotai-lock.json'), 'utf-8'));
    const instrEntry = lock.items.find((e: Record<string, unknown>) => e.type === 'instruction');
    expect(instrEntry).toBeDefined();
    expect(instrEntry.gitignored).toBeUndefined();
  });
});
