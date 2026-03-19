import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSync, parseSyncOptions } from './sync.ts';
import { CommandError } from './command-result.ts';

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual('@clack/prompts');
  return {
    ...actual,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    confirm: vi.fn(),
    spinner: () => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    }),
    log: {
      info: vi.fn(),
      message: vi.fn(),
      step: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  };
});

describe('parseSyncOptions', () => {
  it('should parse --yes flag', () => {
    const { options } = parseSyncOptions(['-y']);
    expect(options.yes).toBe(true);
  });

  it('should parse --force flag', () => {
    const { options } = parseSyncOptions(['--force']);
    expect(options.force).toBe(true);
  });

  it('should parse --agent flag', () => {
    const { options } = parseSyncOptions(['--agents', 'claude-code']);
    expect(options.agents).toEqual(['claude-code']);
  });

  it('should parse multiple agent values', () => {
    const { options } = parseSyncOptions(['-a', 'claude-code', 'cursor']);
    expect(options.agents).toEqual(['claude-code', 'cursor']);
  });

  it('should return empty options for no args', () => {
    const { options } = parseSyncOptions([]);
    expect(options).toEqual({});
  });

  it('should combine multiple flags', () => {
    const { options } = parseSyncOptions(['-y', '-f', '-a', 'claude-code']);
    expect(options.yes).toBe(true);
    expect(options.force).toBe(true);
    expect(options.agents).toEqual(['claude-code']);
  });
});

describe('runSync', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create a temp dir with a node_modules package containing a SKILL.md
    testDir = join(tmpdir(), `sync-test-${Date.now()}`);
    const pkgDir = join(testDir, 'node_modules', 'test-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'SKILL.md'),
      `---
name: test-sync-skill
description: A test skill for sync tests
---

# Test Sync Skill

Content here.
`
    );

    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw CommandError with exit code 1 for invalid agent', async () => {
    await expect(
      runSync([], { agents: ['not-a-real-agent'], yes: true, force: true })
    ).rejects.toThrow(CommandError);

    try {
      await runSync([], { agents: ['not-a-real-agent'], yes: true, force: true });
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).exitCode).toBe(1);
    }
  });

  it('should not throw for valid agents', async () => {
    // With a valid agent and --yes, it should complete without throwing
    await expect(
      runSync([], { agents: ['claude-code'], yes: true, force: true })
    ).resolves.toBeUndefined();
  });
});
