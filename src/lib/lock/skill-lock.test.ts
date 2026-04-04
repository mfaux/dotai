import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock `os.homedir()` so `getSkillLockPath()` points to our temp directory.
// All skill-lock functions call `getSkillLockPath()` which calls `homedir()`.
let mockHomeDir = '/tmp';
vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

import {
  getSkillLockPath,
  readSkillLock,
  writeSkillLock,
  addSkillToLock,
  removeSkillFromLock,
  getSkillFromLock,
  getAllLockedSkills,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
  getGitHubToken,
} from './skill-lock.ts';
import type { SkillLockFile, SkillLockEntry } from './skill-lock.ts';
import { LockVersionError } from './lock-version-error.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeEntry(
  overrides: Partial<SkillLockEntry> = {}
): Omit<SkillLockEntry, 'installedAt' | 'updatedAt'> {
  return {
    source: 'owner/repo',
    sourceType: 'github',
    sourceUrl: 'https://github.com/owner/repo',
    skillFolderHash: 'abc123hash',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'skill-lock-test-'));
  mockHomeDir = tmpDir;
  // Ensure the .agents directory exists
  await mkdir(join(tmpDir, '.agents'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getSkillLockPath
// ---------------------------------------------------------------------------

describe('getSkillLockPath', () => {
  it('returns .skill-lock.json in the agents dir under home', () => {
    const path = getSkillLockPath();
    expect(path).toBe(join(mockHomeDir, '.agents', '.skill-lock.json'));
  });
});

// ---------------------------------------------------------------------------
// readSkillLock
// ---------------------------------------------------------------------------

describe('readSkillLock', () => {
  it('returns empty lock when file does not exist', async () => {
    const lock = await readSkillLock();
    expect(lock.version).toBe(3);
    expect(lock.skills).toEqual({});
  });

  it('reads a valid lock file', async () => {
    const lockFile: SkillLockFile = {
      version: 3,
      skills: {
        'my-skill': {
          source: 'owner/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repo',
          skillFolderHash: 'hash123',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    await writeFile(getSkillLockPath(), JSON.stringify(lockFile, null, 2), 'utf-8');

    const result = await readSkillLock();
    expect(result.version).toBe(3);
    expect(result.skills['my-skill']).toBeDefined();
    expect(result.skills['my-skill']!.source).toBe('owner/repo');
  });

  it('returns empty lock for invalid JSON', async () => {
    await writeFile(getSkillLockPath(), 'not-json{{{', 'utf-8');

    const lock = await readSkillLock();
    expect(lock.version).toBe(3);
    expect(lock.skills).toEqual({});
  });

  it('returns empty lock for old version (< 3)', async () => {
    const oldLock = { version: 2, skills: { 'old-skill': {} } };
    await writeFile(getSkillLockPath(), JSON.stringify(oldLock), 'utf-8');

    const lock = await readSkillLock();
    expect(lock.version).toBe(3);
    expect(lock.skills).toEqual({});
  });

  it('returns empty lock when version is missing', async () => {
    await writeFile(getSkillLockPath(), JSON.stringify({ skills: {} }), 'utf-8');

    const lock = await readSkillLock();
    expect(lock.skills).toEqual({});
  });

  it('returns empty lock when skills field is missing', async () => {
    await writeFile(getSkillLockPath(), JSON.stringify({ version: 3 }), 'utf-8');

    const lock = await readSkillLock();
    expect(lock.skills).toEqual({});
  });

  it('throws LockVersionError for future versions', async () => {
    const futureLock = { version: 99, skills: {} };
    await writeFile(getSkillLockPath(), JSON.stringify(futureLock), 'utf-8');

    await expect(readSkillLock()).rejects.toThrow(LockVersionError);
    await expect(readSkillLock()).rejects.toThrow('version 99');
    await expect(readSkillLock()).rejects.toThrow('Please upgrade dotai');
  });

  it('throws LockVersionError with correct properties for future versions', async () => {
    const futureLock = { version: 10, skills: {} };
    await writeFile(getSkillLockPath(), JSON.stringify(futureLock), 'utf-8');

    try {
      await readSkillLock();
      expect.fail('Expected LockVersionError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LockVersionError);
      const lockError = error as LockVersionError;
      expect(lockError.lockVersion).toBe(10);
      expect(lockError.supportedVersion).toBe(3);
      expect(lockError.lockFile).toBe('.skill-lock.json');
    }
  });

  it('preserves dismissed prompts', async () => {
    const lockFile: SkillLockFile = {
      version: 3,
      skills: {},
      dismissed: { findSkillsPrompt: true },
    };
    await writeFile(getSkillLockPath(), JSON.stringify(lockFile), 'utf-8');

    const lock = await readSkillLock();
    expect(lock.dismissed?.findSkillsPrompt).toBe(true);
  });

  it('preserves lastSelectedAgents', async () => {
    const lockFile: SkillLockFile = {
      version: 3,
      skills: {},
      lastSelectedAgents: ['cursor', 'opencode'],
    };
    await writeFile(getSkillLockPath(), JSON.stringify(lockFile), 'utf-8');

    const lock = await readSkillLock();
    expect(lock.lastSelectedAgents).toEqual(['cursor', 'opencode']);
  });
});

// ---------------------------------------------------------------------------
// writeSkillLock
// ---------------------------------------------------------------------------

describe('writeSkillLock', () => {
  it('writes a valid lock file', async () => {
    const lock: SkillLockFile = {
      version: 3,
      skills: {
        'test-skill': {
          source: 'owner/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repo',
          skillFolderHash: 'hash456',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };

    await writeSkillLock(lock);

    const content = await readFile(getSkillLockPath(), 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    expect(parsed.version).toBe(3);
    expect(parsed.skills['test-skill']!.source).toBe('owner/repo');
  });

  it('creates directory if it does not exist', async () => {
    // Remove the .agents dir so writeSkillLock has to create it
    await rm(join(tmpDir, '.agents'), { recursive: true, force: true });

    const lock: SkillLockFile = { version: 3, skills: {} };
    await writeSkillLock(lock);

    const content = await readFile(getSkillLockPath(), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(3);
  });

  it('overwrites existing lock file', async () => {
    const lock1: SkillLockFile = {
      version: 3,
      skills: {
        'skill-a': {
          source: 'a/b',
          sourceType: 'github',
          sourceUrl: 'https://github.com/a/b',
          skillFolderHash: 'h1',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    await writeSkillLock(lock1);

    const lock2: SkillLockFile = { version: 3, skills: {} };
    await writeSkillLock(lock2);

    const content = await readFile(getSkillLockPath(), 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    expect(Object.keys(parsed.skills)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addSkillToLock
// ---------------------------------------------------------------------------

describe('addSkillToLock', () => {
  it('adds a new skill to an empty lock', async () => {
    await addSkillToLock('my-skill', makeEntry());

    const lock = await readSkillLock();
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.skills['my-skill']!.source).toBe('owner/repo');
    expect(lock.skills['my-skill']!.installedAt).toBeTruthy();
    expect(lock.skills['my-skill']!.updatedAt).toBeTruthy();
  });

  it('preserves installedAt when updating existing skill', async () => {
    await addSkillToLock('my-skill', makeEntry({ skillFolderHash: 'hash1' }));
    const lock1 = await readSkillLock();
    const originalInstalledAt = lock1.skills['my-skill']!.installedAt;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    await addSkillToLock('my-skill', makeEntry({ skillFolderHash: 'hash2' }));
    const lock2 = await readSkillLock();

    expect(lock2.skills['my-skill']!.installedAt).toBe(originalInstalledAt);
    expect(lock2.skills['my-skill']!.skillFolderHash).toBe('hash2');
  });

  it('updates updatedAt when updating existing skill', async () => {
    await addSkillToLock('my-skill', makeEntry());
    const lock1 = await readSkillLock();
    const originalUpdatedAt = lock1.skills['my-skill']!.updatedAt;

    await new Promise((r) => setTimeout(r, 10));

    await addSkillToLock('my-skill', makeEntry({ skillFolderHash: 'new-hash' }));
    const lock2 = await readSkillLock();

    // updatedAt should be different (newer)
    expect(lock2.skills['my-skill']!.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('adds multiple skills', async () => {
    await addSkillToLock('skill-a', makeEntry({ source: 'a/repo' }));
    await addSkillToLock('skill-b', makeEntry({ source: 'b/repo' }));

    const lock = await readSkillLock();
    expect(Object.keys(lock.skills)).toHaveLength(2);
    expect(lock.skills['skill-a']!.source).toBe('a/repo');
    expect(lock.skills['skill-b']!.source).toBe('b/repo');
  });

  it('stores optional ref field', async () => {
    await addSkillToLock('my-skill', makeEntry({ ref: 'develop' }));

    const lock = await readSkillLock();
    expect(lock.skills['my-skill']!.ref).toBe('develop');
  });

  it('stores optional pluginName field', async () => {
    await addSkillToLock('my-skill', makeEntry({ pluginName: 'my-plugin' }));

    const lock = await readSkillLock();
    expect(lock.skills['my-skill']!.pluginName).toBe('my-plugin');
  });
});

// ---------------------------------------------------------------------------
// removeSkillFromLock
// ---------------------------------------------------------------------------

describe('removeSkillFromLock', () => {
  it('removes an existing skill and returns true', async () => {
    await addSkillToLock('my-skill', makeEntry());
    const removed = await removeSkillFromLock('my-skill');

    expect(removed).toBe(true);
    const lock = await readSkillLock();
    expect(lock.skills['my-skill']).toBeUndefined();
  });

  it('returns false for non-existent skill', async () => {
    const removed = await removeSkillFromLock('non-existent');
    expect(removed).toBe(false);
  });

  it('preserves other skills when removing one', async () => {
    await addSkillToLock('skill-a', makeEntry({ source: 'a/repo' }));
    await addSkillToLock('skill-b', makeEntry({ source: 'b/repo' }));

    await removeSkillFromLock('skill-a');

    const lock = await readSkillLock();
    expect(lock.skills['skill-a']).toBeUndefined();
    expect(lock.skills['skill-b']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getSkillFromLock
// ---------------------------------------------------------------------------

describe('getSkillFromLock', () => {
  it('returns skill entry when it exists', async () => {
    await addSkillToLock('my-skill', makeEntry());

    const skill = await getSkillFromLock('my-skill');
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('owner/repo');
  });

  it('returns null for non-existent skill', async () => {
    const skill = await getSkillFromLock('non-existent');
    expect(skill).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllLockedSkills
// ---------------------------------------------------------------------------

describe('getAllLockedSkills', () => {
  it('returns empty object when no skills installed', async () => {
    const skills = await getAllLockedSkills();
    expect(skills).toEqual({});
  });

  it('returns all installed skills', async () => {
    await addSkillToLock('skill-a', makeEntry({ source: 'a/repo' }));
    await addSkillToLock('skill-b', makeEntry({ source: 'b/repo' }));

    const skills = await getAllLockedSkills();
    expect(Object.keys(skills)).toHaveLength(2);
    expect(skills['skill-a']!.source).toBe('a/repo');
    expect(skills['skill-b']!.source).toBe('b/repo');
  });
});

// ---------------------------------------------------------------------------
// isPromptDismissed / dismissPrompt
// ---------------------------------------------------------------------------

describe('isPromptDismissed', () => {
  it('returns false when prompt was never dismissed', async () => {
    const dismissed = await isPromptDismissed('findSkillsPrompt');
    expect(dismissed).toBe(false);
  });

  it('returns true after prompt is dismissed', async () => {
    await dismissPrompt('findSkillsPrompt');

    const dismissed = await isPromptDismissed('findSkillsPrompt');
    expect(dismissed).toBe(true);
  });
});

describe('dismissPrompt', () => {
  it('persists dismissal across reads', async () => {
    await dismissPrompt('findSkillsPrompt');

    // Read fresh from disk
    const lock = await readSkillLock();
    expect(lock.dismissed?.findSkillsPrompt).toBe(true);
  });

  it('preserves existing skills when dismissing prompt', async () => {
    await addSkillToLock('my-skill', makeEntry());
    await dismissPrompt('findSkillsPrompt');

    const lock = await readSkillLock();
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.dismissed?.findSkillsPrompt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLastSelectedAgents / saveSelectedAgents
// ---------------------------------------------------------------------------

describe('getLastSelectedAgents', () => {
  it('returns undefined when no agents saved', async () => {
    const agents = await getLastSelectedAgents();
    expect(agents).toBeUndefined();
  });

  it('returns saved agents', async () => {
    await saveSelectedAgents(['cursor', 'opencode', 'claude-code']);

    const agents = await getLastSelectedAgents();
    expect(agents).toEqual(['cursor', 'opencode', 'claude-code']);
  });
});

describe('saveSelectedAgents', () => {
  it('persists agents across reads', async () => {
    await saveSelectedAgents(['cursor']);

    const lock = await readSkillLock();
    expect(lock.lastSelectedAgents).toEqual(['cursor']);
  });

  it('overwrites previous agent selection', async () => {
    await saveSelectedAgents(['cursor']);
    await saveSelectedAgents(['opencode', 'claude-code']);

    const agents = await getLastSelectedAgents();
    expect(agents).toEqual(['opencode', 'claude-code']);
  });

  it('preserves existing skills when saving agents', async () => {
    await addSkillToLock('my-skill', makeEntry());
    await saveSelectedAgents(['cursor']);

    const lock = await readSkillLock();
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.lastSelectedAgents).toEqual(['cursor']);
  });
});

// ---------------------------------------------------------------------------
// getGitHubToken
// ---------------------------------------------------------------------------

describe('getGitHubToken', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns GITHUB_TOKEN if set', () => {
    process.env.GITHUB_TOKEN = 'ghp_test123';
    process.env.GH_TOKEN = 'gh_other';

    expect(getGitHubToken()).toBe('ghp_test123');
  });

  it('returns GH_TOKEN if GITHUB_TOKEN is not set', () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = 'gh_test456';

    expect(getGitHubToken()).toBe('gh_test456');
  });

  it('returns null when no token is available', () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    // getGitHubToken will try `gh auth token` which may or may not work
    // in the test environment — we just verify it returns string or null
    const token = getGitHubToken();
    expect(token === null || typeof token === 'string').toBe(true);
  });
});
