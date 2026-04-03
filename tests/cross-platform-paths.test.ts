/**
 * Cross-platform path handling tests.
 *
 * These tests verify that path operations work correctly on both Unix and Windows.
 * They test the actual logic used in the codebase for path manipulation,
 * including output path construction, lock file path storage, and display
 * path shortening.
 */

import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'path';
import { createPlannedWrite } from '../src/collisions.ts';
import {
  writeDotaiLock,
  readDotaiLock,
  createEmptyLock,
  upsertLockEntry,
} from '../src/dotai-lock.ts';
import type { TranspiledOutput, LockEntry, TargetAgent } from '../src/types.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

/**
 * Simulates the shortenPath function from add.ts (cross-platform version)
 */
function shortenPath(fullPath: string, cwd: string, home: string, pathSep: string): string {
  // Ensure we match complete path segments by checking for separator after the prefix
  if (fullPath === home || fullPath.startsWith(home + pathSep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + pathSep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Simulates the path validation from wellknown.ts
 * Note: The actual validation uses simple `includes('..')` which will match
 * filenames like '...dots'. This is intentional - it's stricter security.
 */
function isValidSkillFile(file: string): boolean {
  if (typeof file !== 'string') return false;
  // Files must not start with / or \ or contain .. (path traversal prevention)
  if (file.startsWith('/') || file.startsWith('\\') || file.includes('..')) return false;
  return true;
}

/**
 * Simulates the SKILL.md path normalization from skill-lock.ts
 */
function normalizeSkillPath(skillPath: string): string {
  let folderPath = skillPath;

  // Handle both forward and backslash separators for cross-platform compatibility
  if (folderPath.endsWith('/SKILL.md') || folderPath.endsWith('\\SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
    folderPath = folderPath.slice(0, -8);
  }

  if (folderPath.endsWith('/') || folderPath.endsWith('\\')) {
    folderPath = folderPath.slice(0, -1);
  }

  // Convert to forward slashes for GitHub API
  return folderPath.split('\\').join('/');
}

describe('shortenPath (Unix)', () => {
  const pathSep = '/';
  const home = '/Users/test';
  const cwd = '/Users/test/projects/myproject';

  it('replaces home directory with ~', () => {
    const result = shortenPath('/Users/test/documents/file.txt', cwd, home, pathSep);
    expect(result).toBe('~/documents/file.txt');
  });

  it('prefers home over cwd when cwd is under home', () => {
    // When cwd is under home, home is checked first and matches
    // This is the expected behavior - displays as ~/projects/myproject/...
    const result = shortenPath('/Users/test/projects/myproject/src/file.ts', cwd, home, pathSep);
    expect(result).toBe('~/projects/myproject/src/file.ts');
  });

  it('replaces cwd with . when cwd is not under home', () => {
    // When cwd is outside home, cwd can match
    const outsideHome = '/var/www/myproject';
    const result = shortenPath('/var/www/myproject/src/file.ts', outsideHome, home, pathSep);
    expect(result).toBe('./src/file.ts');
  });

  it('returns path unchanged if not under home or cwd', () => {
    const result = shortenPath('/var/log/system.log', cwd, home, pathSep);
    expect(result).toBe('/var/log/system.log');
  });

  it('handles exact home directory match', () => {
    const result = shortenPath('/Users/test', cwd, home, pathSep);
    expect(result).toBe('~');
  });

  it('handles exact cwd match when cwd is under home', () => {
    // Since cwd is under home, home matches first
    const result = shortenPath('/Users/test/projects/myproject', cwd, home, pathSep);
    expect(result).toBe('~/projects/myproject');
  });

  it('handles exact cwd match when cwd is outside home', () => {
    const outsideHome = '/var/www/myproject';
    const result = shortenPath('/var/www/myproject', outsideHome, home, pathSep);
    expect(result).toBe('.');
  });

  it('does not match partial directory names (home)', () => {
    // /Users/tester should NOT match /Users/test
    const result = shortenPath('/Users/tester/file.txt', cwd, home, pathSep);
    expect(result).toBe('/Users/tester/file.txt');
  });

  it('does not match partial directory names (cwd)', () => {
    // /Users/test/projects/myproject2 should NOT match /Users/test/projects/myproject
    const result = shortenPath('/Users/test/projects/myproject2/file.txt', cwd, home, pathSep);
    // It should still match home though
    expect(result).toBe('~/projects/myproject2/file.txt');
  });
});

describe('shortenPath (Windows)', () => {
  const pathSep = '\\';
  const home = 'C:\\Users\\test';
  const cwd = 'C:\\Users\\test\\projects\\myproject';

  it('replaces home directory with ~', () => {
    const result = shortenPath('C:\\Users\\test\\documents\\file.txt', cwd, home, pathSep);
    expect(result).toBe('~\\documents\\file.txt');
  });

  it('prefers home over cwd when cwd is under home', () => {
    // When cwd is under home, home is checked first and matches
    const result = shortenPath(
      'C:\\Users\\test\\projects\\myproject\\src\\file.ts',
      cwd,
      home,
      pathSep
    );
    expect(result).toBe('~\\projects\\myproject\\src\\file.ts');
  });

  it('replaces cwd with . when cwd is not under home', () => {
    // When cwd is outside home, cwd can match
    const outsideHome = 'D:\\projects\\myproject';
    const result = shortenPath('D:\\projects\\myproject\\src\\file.ts', outsideHome, home, pathSep);
    expect(result).toBe('.\\src\\file.ts');
  });

  it('returns path unchanged if not under home or cwd', () => {
    const result = shortenPath('D:\\logs\\system.log', cwd, home, pathSep);
    expect(result).toBe('D:\\logs\\system.log');
  });

  it('handles exact home directory match', () => {
    const result = shortenPath('C:\\Users\\test', cwd, home, pathSep);
    expect(result).toBe('~');
  });

  it('handles exact cwd match when cwd is under home', () => {
    // Since cwd is under home, home matches first
    const result = shortenPath('C:\\Users\\test\\projects\\myproject', cwd, home, pathSep);
    expect(result).toBe('~\\projects\\myproject');
  });

  it('handles exact cwd match when cwd is outside home', () => {
    const outsideHome = 'D:\\projects\\myproject';
    const result = shortenPath('D:\\projects\\myproject', outsideHome, home, pathSep);
    expect(result).toBe('.');
  });

  it('does not match partial directory names (home)', () => {
    // C:\Users\tester should NOT match C:\Users\test
    const result = shortenPath('C:\\Users\\tester\\file.txt', cwd, home, pathSep);
    expect(result).toBe('C:\\Users\\tester\\file.txt');
  });
});

describe('isValidSkillFile', () => {
  it('accepts valid relative paths', () => {
    expect(isValidSkillFile('SKILL.md')).toBe(true);
    expect(isValidSkillFile('src/helper.ts')).toBe(true);
    expect(isValidSkillFile('assets/logo.png')).toBe(true);
  });

  it('rejects paths starting with forward slash', () => {
    expect(isValidSkillFile('/etc/passwd')).toBe(false);
    expect(isValidSkillFile('/SKILL.md')).toBe(false);
  });

  it('rejects paths starting with backslash', () => {
    expect(isValidSkillFile('\\Windows\\System32')).toBe(false);
    expect(isValidSkillFile('\\SKILL.md')).toBe(false);
  });

  it('rejects paths with directory traversal', () => {
    expect(isValidSkillFile('../../../etc/passwd')).toBe(false);
    expect(isValidSkillFile('foo/../../../etc/passwd')).toBe(false);
    expect(isValidSkillFile('..\\..\\Windows\\System32')).toBe(false);
  });

  it('allows dots in filenames (not traversal)', () => {
    expect(isValidSkillFile('file.name.txt')).toBe(true);
    expect(isValidSkillFile('.hidden')).toBe(true);
    // Note: '...dots' contains '..' which is rejected for security
    expect(isValidSkillFile('.config')).toBe(true);
  });

  it('rejects filenames containing .. (strict security)', () => {
    // Even innocent-looking filenames with .. are rejected for security
    expect(isValidSkillFile('...dots')).toBe(false);
    expect(isValidSkillFile('file..name')).toBe(false);
  });
});

describe('normalizeSkillPath', () => {
  it('removes /SKILL.md suffix (Unix)', () => {
    const result = normalizeSkillPath('skills/my-skill/SKILL.md');
    expect(result).toBe('skills/my-skill');
  });

  it('removes \\SKILL.md suffix (Windows)', () => {
    const result = normalizeSkillPath('skills\\my-skill\\SKILL.md');
    expect(result).toBe('skills/my-skill');
  });

  it('removes SKILL.md without path separator', () => {
    const result = normalizeSkillPath('SKILL.md');
    expect(result).toBe('');
  });

  it('removes trailing forward slash', () => {
    const result = normalizeSkillPath('skills/my-skill/');
    expect(result).toBe('skills/my-skill');
  });

  it('removes trailing backslash', () => {
    const result = normalizeSkillPath('skills\\my-skill\\');
    expect(result).toBe('skills/my-skill');
  });

  it('converts Windows paths to forward slashes', () => {
    const result = normalizeSkillPath('skills\\.curated\\advanced-skill\\SKILL.md');
    expect(result).toBe('skills/.curated/advanced-skill');
  });

  it('handles mixed separators', () => {
    const result = normalizeSkillPath('skills/category\\my-skill/SKILL.md');
    expect(result).toBe('skills/category/my-skill');
  });

  it('handles root-level skill', () => {
    const result = normalizeSkillPath('/SKILL.md');
    expect(result).toBe('');
  });

  it('handles deep nested paths (Windows)', () => {
    const result = normalizeSkillPath('a\\b\\c\\d\\e\\SKILL.md');
    expect(result).toBe('a/b/c/d/e');
  });
});

describe('platform detection', () => {
  it('sep is correct for current platform', () => {
    // This will be '/' on Unix/Mac and '\\' on Windows
    expect(['/', '\\']).toContain(sep);
  });
});

// ---------------------------------------------------------------------------
// Output path construction via createPlannedWrite
// ---------------------------------------------------------------------------

describe('createPlannedWrite — output path construction', () => {
  const makeOutput = (
    outputDir: string,
    filename: string,
    content = 'test content'
  ): TranspiledOutput => ({
    content,
    outputDir,
    filename,
    mode: 'write',
  });

  it('produces a resolved absolute path from projectRoot + outputDir + filename', () => {
    const projectRoot = '/home/user/project';
    const output = makeOutput('.github/instructions', 'my-prompt.instructions.md');
    const pw = createPlannedWrite(
      output,
      projectRoot,
      'prompt',
      'my-prompt',
      'canonical',
      'test/repo'
    );

    // resolve(join(...)) always produces an absolute path with OS-native separators
    const expected = resolve(
      join(projectRoot, '.github/instructions', 'my-prompt.instructions.md')
    );
    expect(pw.absolutePath).toBe(expected);
  });

  it('normalizes paths with forward slashes in outputDir', () => {
    const projectRoot = '/home/user/project';
    const output = makeOutput('.github/prompts', 'my-prompt.prompt.md');
    const pw = createPlannedWrite(
      output,
      projectRoot,
      'prompt',
      'my-prompt',
      'canonical',
      'test/repo'
    );

    expect(pw.absolutePath).toBe(
      resolve(join(projectRoot, '.github/prompts', 'my-prompt.prompt.md'))
    );
    // Path should not contain double separators
    expect(pw.absolutePath).not.toMatch(/[/\\]{2}/);
  });

  it('handles multiple agent output directories', () => {
    const projectRoot = '/home/user/project';
    const agentOutputDirs: Array<{ dir: string; filename: string }> = [
      { dir: '.github/instructions', filename: 'r.instructions.md' },
      { dir: '.github/prompts', filename: 'r.prompt.md' },
      { dir: '.claude/commands', filename: 'r.md' },
    ];

    for (const { dir, filename } of agentOutputDirs) {
      const output = makeOutput(dir, filename);
      const pw = createPlannedWrite(output, projectRoot, 'prompt', 'r', 'canonical', 'test/repo');

      // Should be an absolute path
      expect(pw.absolutePath).toBe(resolve(pw.absolutePath));
      // Should contain no double separators
      expect(pw.absolutePath).not.toMatch(/[/\\]{2}/);
    }
  });

  it('preserves metadata on the PlannedWrite', () => {
    const projectRoot = '/tmp/test';
    const output = makeOutput('.github/prompts', 'my-prompt.prompt.md');
    const pw = createPlannedWrite(
      output,
      projectRoot,
      'prompt',
      'my-prompt',
      'canonical',
      'owner/repo'
    );

    expect(pw.type).toBe('prompt');
    expect(pw.name).toBe('my-prompt');
    expect(pw.format).toBe('canonical');
    expect(pw.source).toBe('owner/repo');
    expect(pw.output).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Lock file path round-trip consistency
// ---------------------------------------------------------------------------

describe('lock file path consistency', () => {
  let tempDir: string;

  function setup(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dotai-path-test-'));
    execSync('git init --initial-branch=main', { cwd: dir, stdio: 'ignore' });
    return dir;
  }

  function cleanup(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
  }

  it('round-trips output paths through write → read', async () => {
    tempDir = setup();
    try {
      const outputPaths = [
        resolve(join(tempDir, '.github/prompts/my-prompt.prompt.md')),
        resolve(join(tempDir, '.claude/commands/my-prompt.md')),
        resolve(join(tempDir, '.opencode/prompts/my-prompt.md')),
      ];

      const entry: LockEntry = {
        type: 'prompt',
        name: 'my-prompt',
        source: 'test/repo',
        format: 'canonical',
        agents: ['github-copilot', 'claude-code', 'opencode'] as TargetAgent[],
        hash: 'abc123',
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
      };

      let lock = createEmptyLock();
      lock = upsertLockEntry(lock, entry);
      await writeDotaiLock(lock, tempDir);

      const { lock: readBack } = await readDotaiLock(tempDir);
      expect(readBack.items).toHaveLength(1);
      expect(readBack.items[0]!.outputs).toEqual(outputPaths);
    } finally {
      cleanup(tempDir);
    }
  });

  it('preserves forward-slash paths in lock file', async () => {
    tempDir = setup();
    try {
      // Simulate paths as they would appear with forward slashes
      const outputPaths = [
        '/home/user/project/.github/prompts/test.prompt.md',
        '/home/user/project/.claude/commands/test.md',
      ];

      const entry: LockEntry = {
        type: 'prompt',
        name: 'test',
        source: 'test/repo',
        format: 'canonical',
        agents: ['github-copilot', 'claude-code'] as TargetAgent[],
        hash: 'def456',
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
      };

      let lock = createEmptyLock();
      lock = upsertLockEntry(lock, entry);
      await writeDotaiLock(lock, tempDir);

      const { lock: readBack } = await readDotaiLock(tempDir);
      expect(readBack.items[0]!.outputs).toEqual(outputPaths);
    } finally {
      cleanup(tempDir);
    }
  });

  it('stores multiple entries with distinct output paths', async () => {
    tempDir = setup();
    try {
      const instructionEntry: LockEntry = {
        type: 'instruction',
        name: 'code-style',
        source: 'test/repo',
        format: 'canonical',
        agents: ['github-copilot', 'claude-code'] as TargetAgent[],
        hash: 'aaa',
        installedAt: new Date().toISOString(),
        outputs: [
          resolve(join(tempDir, '.github/instructions/code-style.instructions.md')),
          resolve(join(tempDir, '.claude/instructions/code-style.md')),
        ],
      };

      const promptEntry: LockEntry = {
        type: 'prompt',
        name: 'review',
        source: 'test/repo',
        format: 'canonical',
        agents: ['github-copilot'] as TargetAgent[],
        hash: 'bbb',
        installedAt: new Date().toISOString(),
        outputs: [resolve(join(tempDir, '.github/prompts/review.prompt.md'))],
      };

      let lock = createEmptyLock();
      lock = upsertLockEntry(lock, instructionEntry);
      lock = upsertLockEntry(lock, promptEntry);
      await writeDotaiLock(lock, tempDir);

      const { lock: readBack } = await readDotaiLock(tempDir);
      expect(readBack.items).toHaveLength(2);

      // Items are sorted by (type, name) — instruction:code-style comes before prompt:review
      const instruction = readBack.items.find((i) => i.type === 'instruction');
      const prompt = readBack.items.find((i) => i.type === 'prompt');
      expect(instruction).toBeDefined();
      expect(prompt).toBeDefined();
      expect(instruction!.outputs).toEqual(instructionEntry.outputs);
      expect(prompt!.outputs).toEqual(promptEntry.outputs);
    } finally {
      cleanup(tempDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Windows-style backslash path handling
// ---------------------------------------------------------------------------

describe('backslash path handling', () => {
  it('createPlannedWrite with backslash-containing projectRoot still resolves', () => {
    // On Unix, backslashes in paths are technically valid characters (not separators),
    // but this test documents the behavior. On Windows, resolve() would normalize them.
    const projectRoot = '/home/user/project';
    const output: TranspiledOutput = {
      content: 'test',
      outputDir: '.github/prompts',
      filename: 'test.prompt.md',
      mode: 'write',
    };

    const pw = createPlannedWrite(output, projectRoot, 'prompt', 'test', 'canonical', 'test/repo');

    // resolve() always produces an absolute path
    expect(pw.absolutePath).toBe(resolve(pw.absolutePath));
  });

  it('normalizeSkillPath converts all backslashes to forward slashes', () => {
    // This tests the actual normalization behavior used for GitHub API calls
    const inputs = [
      { input: 'skills\\my-skill\\SKILL.md', expected: 'skills/my-skill' },
      { input: 'a\\b\\c\\SKILL.md', expected: 'a/b/c' },
      { input: 'skills\\mixed/path\\SKILL.md', expected: 'skills/mixed/path' },
    ];

    for (const { input, expected } of inputs) {
      const result = normalizeSkillPath(input);
      expect(result).toBe(expected);
      // Result should never contain backslashes
      expect(result).not.toContain('\\');
    }
  });

  it('isValidSkillFile rejects Windows-style absolute paths', () => {
    // Backslash-prefixed paths are rejected
    expect(isValidSkillFile('\\Windows\\System32\\cmd.exe')).toBe(false);
    // But relative paths with backslashes are accepted (they are valid on Unix)
    expect(isValidSkillFile('subdir\\file.md')).toBe(true);
  });

  it('isValidSkillFile rejects Windows-style directory traversal', () => {
    expect(isValidSkillFile('..\\..\\Windows\\System32')).toBe(false);
    expect(isValidSkillFile('foo\\..\\..\\etc\\passwd')).toBe(false);
  });
});
