import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  readDotaiLock,
  writeDotaiLock,
  getDotaiLockPath,
  findLockEntry,
  upsertLockEntry,
  removeLockEntry,
  getLockEntriesByType,
  getLockEntriesBySource,
  computeContentHash,
  createEmptyLock,
  getCurrentVersion,
  LockVersionError,
} from './dotai-lock.ts';
import type { DotaiLockFile } from './dotai-lock.ts';
import type { LockEntry } from '../types.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLockEntry(overrides: Partial<LockEntry> = {}): LockEntry {
  return {
    type: 'prompt',
    name: 'code-style',
    source: 'acme/repo',
    format: 'canonical',
    agents: ['cursor', 'github-copilot', 'claude-code', 'opencode'],
    hash: 'abc123',
    installedAt: '2026-02-28T12:00:00.000Z',
    outputs: [
      '/project/.cursor/rules/code-style.mdc',
      '/project/.github/instructions/code-style.instructions.md',
    ],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dotai-lock-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getDotaiLockPath
// ---------------------------------------------------------------------------

describe('getDotaiLockPath', () => {
  it('returns .dotai-lock.json in the project root', () => {
    expect(getDotaiLockPath('/my/project')).toBe(join('/my/project', '.dotai-lock.json'));
  });
});

// ---------------------------------------------------------------------------
// createEmptyLock / getCurrentVersion
// ---------------------------------------------------------------------------

describe('createEmptyLock', () => {
  it('returns version 1 with empty items', () => {
    const lock = createEmptyLock();
    expect(lock.version).toBe(1);
    expect(lock.items).toEqual([]);
  });
});

describe('getCurrentVersion', () => {
  it('returns 1', () => {
    expect(getCurrentVersion()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// readDotaiLock
// ---------------------------------------------------------------------------

describe('readDotaiLock', () => {
  it('returns empty lock when file does not exist', async () => {
    const result = await readDotaiLock(tmpDir);
    expect(result.lock.version).toBe(1);
    expect(result.lock.items).toEqual([]);
    expect(result.migrated).toBe(false);
  });

  it('reads a valid lock file', async () => {
    const entry = makeLockEntry();
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock, null, 2), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.version).toBe(1);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.name).toBe('code-style');
    expect(result.migrated).toBe(false);
  });

  it('returns empty lock for invalid JSON', async () => {
    await writeFile(getDotaiLockPath(tmpDir), 'not-json{{{', 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.version).toBe(1);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock for non-object JSON', async () => {
    await writeFile(getDotaiLockPath(tmpDir), '"just a string"', 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock when version is missing', async () => {
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify({ items: [] }), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock when version is not a number', async () => {
    await writeFile(
      getDotaiLockPath(tmpDir),
      JSON.stringify({ version: 'one', items: [] }),
      'utf-8'
    );

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock when version is zero', async () => {
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify({ version: 0, items: [] }), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock when version is fractional', async () => {
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify({ version: 1.5, items: [] }), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('returns empty lock when items is not an array', async () => {
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify({ version: 1, items: {} }), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('throws LockVersionError for future versions', async () => {
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify({ version: 99, items: [] }), 'utf-8');

    await expect(readDotaiLock(tmpDir)).rejects.toThrow(LockVersionError);
    await expect(readDotaiLock(tmpDir)).rejects.toThrow('version 99');
    await expect(readDotaiLock(tmpDir)).rejects.toThrow('Please upgrade dotai');
  });

  it('filters out invalid items', async () => {
    const validEntry = makeLockEntry();
    const lock = {
      version: 1,
      items: [
        validEntry,
        { type: 'invalid-type', name: 'bad' }, // invalid type
        { type: 'prompt', name: '' }, // empty name
        {
          type: 'prompt',
          name: 'ok',
          source: '',
          format: 'canonical',
          agents: [],
          hash: 'h',
          installedAt: 'now',
          outputs: [],
        }, // empty source
        'not an object', // not an object
        null, // null
      ],
    };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.name).toBe('code-style');
  });

  it('silently drops legacy rule entries from lock file', async () => {
    const promptEntry = makeLockEntry({ type: 'prompt', name: 'my-prompt' });
    // Manually construct a rule entry (can't use makeLockEntry since 'rule' is
    // no longer a valid ContextType)
    const ruleEntry = {
      type: 'rule',
      name: 'my-rule',
      source: 'acme/repo',
      format: 'canonical',
      agents: ['cursor', 'github-copilot', 'claude-code', 'opencode'],
      hash: 'abc123',
      installedAt: '2026-02-28T12:00:00.000Z',
      outputs: ['/project/.cursor/rules/my-rule.mdc'],
    };
    const lock = { version: 1, items: [promptEntry, ruleEntry] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    // Rule entry should be silently dropped
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.type).toBe('prompt');
    expect(result.lock.items[0]!.name).toBe('my-prompt');
  });

  it('validates agent names in items', async () => {
    const badEntry = makeLockEntry({ agents: ['invalid-agent' as 'cursor'] });
    const lock = { version: 1, items: [badEntry] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });

  it('validates format field in items', async () => {
    const badEntry = makeLockEntry({ format: 'native:invalid' as 'canonical' });
    const lock = { version: 1, items: [badEntry] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });

  it('accepts native format with valid agent', async () => {
    const entry = makeLockEntry({ format: 'native:cursor' });
    const lock = { version: 1, items: [entry] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.format).toBe('native:cursor');
  });

  it('returns empty lock for git merge conflict markers', async () => {
    await writeFile(
      getDotaiLockPath(tmpDir),
      '<<<<<<< HEAD\n{"version":1}\n=======\n{"version":1}\n>>>>>>> branch\n',
      'utf-8'
    );

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeDotaiLock
// ---------------------------------------------------------------------------

describe('writeDotaiLock', () => {
  it('writes a valid lock file', async () => {
    const entry = makeLockEntry();
    const lock: DotaiLockFile = { version: 1, items: [entry] };

    await writeDotaiLock(lock, tmpDir);

    const content = await readFile(getDotaiLockPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(content) as DotaiLockFile;
    expect(parsed.version).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.name).toBe('code-style');
  });

  it('sorts items by (type, name)', async () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'skill', name: 'zeta' }),
        makeLockEntry({ type: 'prompt', name: 'beta' }),
        makeLockEntry({ type: 'prompt', name: 'alpha' }),
        makeLockEntry({ type: 'skill', name: 'alpha' }),
      ],
    };

    await writeDotaiLock(lock, tmpDir);

    const content = await readFile(getDotaiLockPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(content) as DotaiLockFile;
    const keys = parsed.items.map((i) => `${i.type}:${i.name}`);
    expect(keys).toEqual(['prompt:alpha', 'prompt:beta', 'skill:alpha', 'skill:zeta']);
  });

  it('appends trailing newline', async () => {
    await writeDotaiLock(createEmptyLock(), tmpDir);

    const content = await readFile(getDotaiLockPath(tmpDir), 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('produces pretty-printed JSON', async () => {
    await writeDotaiLock(createEmptyLock(), tmpDir);

    const content = await readFile(getDotaiLockPath(tmpDir), 'utf-8');
    expect(content).toContain('\n'); // Multi-line
    expect(content).toMatch(/^\{\n/); // Starts with formatted opening brace
  });

  it('overwrites existing lock file', async () => {
    const lock1: DotaiLockFile = { version: 1, items: [makeLockEntry({ name: 'first' })] };
    const lock2: DotaiLockFile = { version: 1, items: [makeLockEntry({ name: 'second' })] };

    await writeDotaiLock(lock1, tmpDir);
    await writeDotaiLock(lock2, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.name).toBe('second');
  });

  it('cleans up temp file on success (no leftover .tmp)', async () => {
    await writeDotaiLock(createEmptyLock(), tmpDir);

    const { readdir } = await import('fs/promises');
    const files = await readdir(tmpDir);
    expect(files).toEqual(['.dotai-lock.json']);
    expect(files).not.toContain('.dotai-lock.json.tmp');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: write then read
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('preserves all lock entry fields through write/read', async () => {
    const entry = makeLockEntry({
      type: 'prompt',
      name: 'security',
      source: 'org/security-rules',
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: 'sha256hex',
      installedAt: '2026-01-15T08:30:00.000Z',
      outputs: ['/p/.github/instructions/security.instructions.md', '/p/.claude/rules/security.md'],
    });

    await writeDotaiLock({ version: 1, items: [entry] }, tmpDir);
    const result = await readDotaiLock(tmpDir);

    expect(result.lock.items[0]).toEqual(entry);
  });

  it('preserves multiple items', async () => {
    const items = [
      makeLockEntry({ type: 'prompt', name: 'alpha' }),
      makeLockEntry({ type: 'prompt', name: 'beta' }),
      makeLockEntry({ type: 'skill', name: 'gamma' }),
    ];

    await writeDotaiLock({ version: 1, items }, tmpDir);
    const result = await readDotaiLock(tmpDir);

    expect(result.lock.items).toHaveLength(3);
  });

  it('preserves prompt lock entries through write/read', async () => {
    const entry = makeLockEntry({
      type: 'prompt',
      name: 'review-code',
      source: 'acme/prompts',
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: 'prompthash123',
      outputs: ['/p/.github/prompts/review-code.prompt.md', '/p/.claude/commands/review-code.md'],
    });

    await writeDotaiLock({ version: 1, items: [entry] }, tmpDir);
    const result = await readDotaiLock(tmpDir);

    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]).toEqual(entry);
  });

  it('sorts prompt entries alongside other types and skills', async () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'skill', name: 'zeta' }),
        makeLockEntry({ type: 'prompt', name: 'review' }),
        makeLockEntry({ type: 'prompt', name: 'alpha' }),
        makeLockEntry({ type: 'prompt', name: 'deploy' }),
      ],
    };

    await writeDotaiLock(lock, tmpDir);
    const result = await readDotaiLock(tmpDir);
    const keys = result.lock.items.map((i) => `${i.type}:${i.name}`);
    expect(keys).toEqual(['prompt:alpha', 'prompt:deploy', 'prompt:review', 'skill:zeta']);
  });
});

// ---------------------------------------------------------------------------
// findLockEntry
// ---------------------------------------------------------------------------

describe('findLockEntry', () => {
  it('finds entry by (type, name)', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'prompt', name: 'alpha' }),
        makeLockEntry({ type: 'prompt', name: 'beta' }),
        makeLockEntry({ type: 'skill', name: 'alpha' }),
      ],
    };

    const found = findLockEntry(lock, 'prompt', 'beta');
    expect(found).toBeDefined();
    expect(found!.name).toBe('beta');
    expect(found!.type).toBe('prompt');
  });

  it('returns undefined when not found', () => {
    const lock = createEmptyLock();
    expect(findLockEntry(lock, 'prompt', 'nonexistent')).toBeUndefined();
  });

  it('distinguishes between types with the same name', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'prompt', name: 'auth', source: 'prompt-source' }),
        makeLockEntry({ type: 'skill', name: 'auth', source: 'skill-source' }),
      ],
    };

    const promptEntry = findLockEntry(lock, 'prompt', 'auth');
    const skillEntry = findLockEntry(lock, 'skill', 'auth');

    expect(promptEntry!.source).toBe('prompt-source');
    expect(skillEntry!.source).toBe('skill-source');
  });
});

// ---------------------------------------------------------------------------
// upsertLockEntry
// ---------------------------------------------------------------------------

describe('upsertLockEntry', () => {
  it('adds a new entry to an empty lock', () => {
    const lock = createEmptyLock();
    const entry = makeLockEntry();

    const updated = upsertLockEntry(lock, entry);
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]!.name).toBe('code-style');
  });

  it('replaces existing entry with same (type, name)', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [makeLockEntry({ hash: 'old-hash' })],
    };

    const updated = upsertLockEntry(lock, makeLockEntry({ hash: 'new-hash' }));
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]!.hash).toBe('new-hash');
  });

  it('preserves original installedAt on update', () => {
    const original = makeLockEntry({ installedAt: '2026-01-01T00:00:00.000Z' });
    const lock: DotaiLockFile = { version: 1, items: [original] };

    const replacement = makeLockEntry({ installedAt: '2026-02-28T12:00:00.000Z', hash: 'new' });
    const updated = upsertLockEntry(lock, replacement);

    expect(updated.items[0]!.installedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.items[0]!.hash).toBe('new');
  });

  it('does not modify the original lock object', () => {
    const lock = createEmptyLock();
    const entry = makeLockEntry();

    const updated = upsertLockEntry(lock, entry);
    expect(lock.items).toHaveLength(0);
    expect(updated.items).toHaveLength(1);
  });

  it('adds entry alongside different (type, name) entries', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [makeLockEntry({ name: 'existing' })],
    };

    const updated = upsertLockEntry(lock, makeLockEntry({ name: 'new-rule' }));
    expect(updated.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// removeLockEntry
// ---------------------------------------------------------------------------

describe('removeLockEntry', () => {
  it('removes an existing entry', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [makeLockEntry({ name: 'alpha' }), makeLockEntry({ name: 'beta' })],
    };

    const { lock: updated, removed } = removeLockEntry(lock, 'prompt', 'alpha');
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]!.name).toBe('beta');
    expect(removed).toBeDefined();
    expect(removed!.name).toBe('alpha');
  });

  it('returns undefined when entry not found', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [makeLockEntry({ name: 'alpha' })],
    };

    const { lock: updated, removed } = removeLockEntry(lock, 'prompt', 'nonexistent');
    expect(updated.items).toHaveLength(1);
    expect(removed).toBeUndefined();
  });

  it('does not modify the original lock object', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [makeLockEntry()],
    };

    const { lock: updated } = removeLockEntry(lock, 'prompt', 'code-style');
    expect(lock.items).toHaveLength(1);
    expect(updated.items).toHaveLength(0);
  });

  it('removes only the matching (type, name)', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'prompt', name: 'auth' }),
        makeLockEntry({ type: 'skill', name: 'auth' }),
      ],
    };

    const { lock: updated } = removeLockEntry(lock, 'prompt', 'auth');
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]!.type).toBe('skill');
  });
});

// ---------------------------------------------------------------------------
// getLockEntriesByType
// ---------------------------------------------------------------------------

describe('getLockEntriesByType', () => {
  it('returns only entries of the given type', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'prompt', name: 'a' }),
        makeLockEntry({ type: 'skill', name: 'b' }),
        makeLockEntry({ type: 'prompt', name: 'c' }),
      ],
    };

    const prompts = getLockEntriesByType(lock, 'prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts.map((r) => r.name)).toEqual(['a', 'c']);
  });

  it('returns empty array when no entries match', () => {
    const lock = createEmptyLock();
    expect(getLockEntriesByType(lock, 'skill')).toEqual([]);
  });

  it('returns only prompt entries when filtering by prompt type', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ type: 'instruction', name: 'a' }),
        makeLockEntry({ type: 'prompt', name: 'b' }),
        makeLockEntry({ type: 'skill', name: 'c' }),
        makeLockEntry({ type: 'prompt', name: 'd' }),
      ],
    };

    const prompts = getLockEntriesByType(lock, 'prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts.map((p) => p.name)).toEqual(['b', 'd']);
  });
});

// ---------------------------------------------------------------------------
// getLockEntriesBySource
// ---------------------------------------------------------------------------

describe('getLockEntriesBySource', () => {
  it('returns only entries from the given source', () => {
    const lock: DotaiLockFile = {
      version: 1,
      items: [
        makeLockEntry({ name: 'a', source: 'acme/repo' }),
        makeLockEntry({ name: 'b', source: 'other/repo' }),
        makeLockEntry({ name: 'c', source: 'acme/repo' }),
      ],
    };

    const acme = getLockEntriesBySource(lock, 'acme/repo');
    expect(acme).toHaveLength(2);
    expect(acme.map((e) => e.name)).toEqual(['a', 'c']);
  });

  it('returns empty array when no entries match', () => {
    const lock = createEmptyLock();
    expect(getLockEntriesBySource(lock, 'nobody/nothing')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeContentHash
// ---------------------------------------------------------------------------

describe('computeContentHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns deterministic results', () => {
    const a = computeContentHash('test content');
    const b = computeContentHash('test content');
    expect(a).toBe(b);
  });

  it('returns different hashes for different content', () => {
    const a = computeContentHash('content a');
    const b = computeContentHash('content b');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// LockVersionError
// ---------------------------------------------------------------------------

describe('LockVersionError', () => {
  it('has correct name and properties', () => {
    const err = new LockVersionError(5, 1, '.dotai-lock.json');
    expect(err.name).toBe('LockVersionError');
    expect(err.lockVersion).toBe(5);
    expect(err.supportedVersion).toBe(1);
    expect(err.lockFile).toBe('.dotai-lock.json');
    expect(err.message).toContain('version 5');
    expect(err.message).toContain('version 1');
    expect(err.message).toContain('upgrade dotai');
  });

  it('is an instance of Error', () => {
    const err = new LockVersionError(2, 1, '.dotai-lock.json');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Migration framework
// ---------------------------------------------------------------------------

describe('migration framework', () => {
  it('current version reads without migration flag', async () => {
    const lock: DotaiLockFile = { version: 1, items: [] };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.originalVersion).toBeUndefined();
  });

  // Note: We cannot test actual migration without bumping CURRENT_VERSION,
  // but we test the framework handles the version < CURRENT case correctly
  // by verifying the edge cases above (invalid versions return empty locks).
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles empty items array', async () => {
    const lock: DotaiLockFile = { version: 1, items: [] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toEqual([]);
  });

  it('handles items with empty outputs array', async () => {
    const entry = makeLockEntry({ outputs: [] });
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items[0]!.outputs).toEqual([]);
  });

  it('handles items with many agents', async () => {
    const entry = makeLockEntry({
      agents: ['github-copilot', 'claude-code', 'cursor', 'opencode'],
    });
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items[0]!.agents).toHaveLength(4);
  });

  it('handles concurrent reads and writes safely (write-then-read)', async () => {
    const lock1: DotaiLockFile = { version: 1, items: [makeLockEntry({ name: 'alpha' })] };
    const lock2: DotaiLockFile = { version: 1, items: [makeLockEntry({ name: 'beta' })] };

    // Write both — second write wins
    await writeDotaiLock(lock1, tmpDir);
    await writeDotaiLock(lock2, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.name).toBe('beta');
  });

  it('validates outputs contains only strings', async () => {
    const lock = {
      version: 1,
      items: [
        {
          type: 'prompt',
          name: 'bad-outputs',
          source: 'acme/repo',
          format: 'canonical',
          agents: ['cursor'],
          hash: 'abc',
          installedAt: '2026-01-01T00:00:00.000Z',
          outputs: [123, null], // Invalid: non-string outputs
        },
      ],
    };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });

  it('accepts items with gitignored: true', async () => {
    const entry = makeLockEntry({ gitignored: true });
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.gitignored).toBe(true);
  });

  it('accepts items with gitignored: false', async () => {
    const entry = makeLockEntry({ gitignored: false });
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.gitignored).toBe(false);
  });

  it('accepts items without gitignored field (undefined)', async () => {
    const entry = makeLockEntry();
    const lock: DotaiLockFile = { version: 1, items: [entry] };
    await writeDotaiLock(lock, tmpDir);

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(1);
    expect(result.lock.items[0]!.gitignored).toBeUndefined();
  });

  it('rejects items with non-boolean gitignored', async () => {
    const lock = {
      version: 1,
      items: [
        {
          type: 'prompt',
          name: 'bad-gitignored',
          source: 'acme/repo',
          format: 'canonical',
          agents: ['cursor'],
          hash: 'abc',
          installedAt: '2026-01-01T00:00:00.000Z',
          outputs: [],
          gitignored: 'yes', // Invalid: should be boolean
        },
      ],
    };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });

  it('rejects items with non-boolean append', async () => {
    const lock = {
      version: 1,
      items: [
        {
          type: 'prompt',
          name: 'bad-append',
          source: 'acme/repo',
          format: 'canonical',
          agents: ['cursor'],
          hash: 'abc',
          installedAt: '2026-01-01T00:00:00.000Z',
          outputs: [],
          append: 'yes', // Invalid: should be boolean
        },
      ],
    };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });

  it('rejects items with missing hash', async () => {
    const lock = {
      version: 1,
      items: [
        {
          type: 'prompt',
          name: 'no-hash',
          source: 'acme/repo',
          format: 'canonical',
          agents: ['cursor'],
          hash: '',
          installedAt: '2026-01-01T00:00:00.000Z',
          outputs: [],
        },
      ],
    };
    await writeFile(getDotaiLockPath(tmpDir), JSON.stringify(lock), 'utf-8');

    const result = await readDotaiLock(tmpDir);
    expect(result.lock.items).toHaveLength(0);
  });
});
