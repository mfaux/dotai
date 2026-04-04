import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSkillUpdates } from './check.ts';
import type { SkillLockEntry } from './lib/lock/index.ts';

// Mock fetchSkillFolderHash from skill-lock.ts
vi.mock('./lib/lock/skill-lock.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/lock/skill-lock.ts')>();
  return {
    ...original,
    fetchSkillFolderHash: vi.fn(),
  };
});

import { fetchSkillFolderHash } from './lib/lock/index.ts';
const mockFetch = vi.mocked(fetchSkillFolderHash);

function makeEntry(overrides: Partial<SkillLockEntry> = {}): SkillLockEntry {
  return {
    source: 'owner/repo',
    sourceType: 'github',
    sourceUrl: 'https://github.com/owner/repo',
    skillPath: 'skills/my-skill/SKILL.md',
    skillFolderHash: 'abc123',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findSkillUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns updates when hash differs', async () => {
    mockFetch.mockResolvedValue('new-hash-456');

    const skills = {
      'my-skill': makeEntry({ skillFolderHash: 'old-hash-123' }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.name).toBe('my-skill');
    expect(result.updates[0]!.source).toBe('owner/repo');
    expect(result.updates[0]!.entry.skillFolderHash).toBe('old-hash-123');
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(1);
  });

  it('returns empty when all hashes match', async () => {
    mockFetch.mockResolvedValue('same-hash');

    const skills = {
      'my-skill': makeEntry({ skillFolderHash: 'same-hash' }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(1);
  });

  it('skips non-GitHub sources', async () => {
    const skills = {
      'local-skill': makeEntry({ sourceType: 'local' }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips entries without skillFolderHash', async () => {
    const skills = {
      'no-hash': makeEntry({ skillFolderHash: '' }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips entries without skillPath', async () => {
    const skills = {
      'no-path': makeEntry({ skillPath: undefined }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('collects errors without throwing', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const skills = {
      'failing-skill': makeEntry(),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.name).toBe('failing-skill');
    expect(result.errors[0]!.error).toBe('Network failure');
    expect(result.checkedCount).toBe(1);
  });

  it('records error when fetchSkillFolderHash returns null', async () => {
    mockFetch.mockResolvedValue(null);

    const skills = {
      'missing-skill': makeEntry(),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toBe('Could not fetch from GitHub');
    expect(result.checkedCount).toBe(1);
  });

  it('handles multiple skills with mixed results', async () => {
    mockFetch
      .mockResolvedValueOnce('new-hash') // updated
      .mockResolvedValueOnce('same-hash') // up-to-date
      .mockRejectedValueOnce(new Error('API error')); // error

    const skills = {
      'skill-updated': makeEntry({ skillFolderHash: 'old-hash', source: 'a/b' }),
      'skill-current': makeEntry({ skillFolderHash: 'same-hash', source: 'c/d' }),
      'skill-error': makeEntry({ source: 'e/f' }),
    };

    const result = await findSkillUpdates(skills, null);

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.name).toBe('skill-updated');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.name).toBe('skill-error');
    expect(result.checkedCount).toBe(3);
  });

  it('passes token and ref to fetchSkillFolderHash', async () => {
    mockFetch.mockResolvedValue('hash');

    const skills = {
      'my-skill': makeEntry({ ref: 'v2' }),
    };

    await findSkillUpdates(skills, 'my-token');

    expect(mockFetch).toHaveBeenCalledWith(
      'owner/repo',
      'skills/my-skill/SKILL.md',
      'my-token',
      'v2'
    );
  });

  it('returns empty result for empty skills', async () => {
    const result = await findSkillUpdates({}, null);

    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
  });
});
