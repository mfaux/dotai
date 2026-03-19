import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Track calls to the mock simple-git instance
const mockClone = vi.fn();
const mockEnv = vi.fn().mockReturnThis();

vi.mock('simple-git', () => ({
  default: () => ({
    env: mockEnv,
    clone: mockClone,
  }),
}));

import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';

beforeEach(() => {
  vi.clearAllMocks();
  mockClone.mockResolvedValue(undefined);
  mockEnv.mockReturnThis();
});

// ---------------------------------------------------------------------------
// cloneRepo — environment handling
// ---------------------------------------------------------------------------

describe('cloneRepo', () => {
  it('passes process.env with GIT_TERMINAL_PROMPT=0 to simple-git', async () => {
    await cloneRepo('https://github.com/example/repo.git');

    // .env() should be called with an object containing both process.env vars
    // and GIT_TERMINAL_PROMPT=0 — NOT just { GIT_TERMINAL_PROMPT: '0' }
    expect(mockEnv).toHaveBeenCalledTimes(1);
    const envArg = mockEnv.mock.calls[0]![0];

    // Must be an object (not a string key), meaning the full env is passed
    expect(typeof envArg).toBe('object');
    // Must include GIT_TERMINAL_PROMPT
    expect(envArg).toHaveProperty('GIT_TERMINAL_PROMPT', '0');
    // Must include inherited process.env variables like PATH
    expect(envArg).toHaveProperty('PATH');
  });

  it('clones with --depth 1 by default', async () => {
    await cloneRepo('https://github.com/example/repo.git');

    expect(mockClone).toHaveBeenCalledWith(
      'https://github.com/example/repo.git',
      expect.any(String),
      ['--depth', '1']
    );
  });

  it('clones with --branch when ref is provided', async () => {
    await cloneRepo('https://github.com/example/repo.git', 'v1.0');

    expect(mockClone).toHaveBeenCalledWith(
      'https://github.com/example/repo.git',
      expect.any(String),
      ['--depth', '1', '--branch', 'v1.0']
    );
  });

  it('throws GitCloneError with isAuthError on auth failures', async () => {
    mockClone.mockRejectedValue(new Error('could not read Username for'));

    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toThrow(GitCloneError);
    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toMatchObject({
      isAuthError: true,
      isTimeout: false,
    });
  });

  it('throws GitCloneError with isTimeout on timeout', async () => {
    mockClone.mockRejectedValue(new Error('block timeout'));

    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toThrow(GitCloneError);
    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toMatchObject({
      isTimeout: true,
      isAuthError: false,
    });
  });

  it('throws generic GitCloneError for other errors', async () => {
    mockClone.mockRejectedValue(new Error('something else went wrong'));

    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toThrow(GitCloneError);
    await expect(cloneRepo('https://github.com/example/repo.git')).rejects.toMatchObject({
      isTimeout: false,
      isAuthError: false,
    });
  });
});

// ---------------------------------------------------------------------------
// cleanupTempDir
// ---------------------------------------------------------------------------

describe('cleanupTempDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dotai-git-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('removes a directory within tmpdir', async () => {
    await cleanupTempDir(tempDir);
    const { existsSync } = await import('fs');
    expect(existsSync(tempDir)).toBe(false);
  });

  it('rejects paths outside tmpdir', async () => {
    await expect(cleanupTempDir('/home/user/important')).rejects.toThrow(
      'Attempted to clean up directory outside of temp directory'
    );
  });
});
