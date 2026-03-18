import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./skill-lock.ts', () => ({
  getGitHubToken: () => null,
}));

import { fetchRepoTree } from './github-trees.ts';

describe('fetchRepoTree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns tree entries on success', async () => {
    const mockTree = {
      sha: 'root-sha',
      tree: [
        { path: 'README.md', type: 'blob', sha: 'aaa' },
        { path: 'skills', type: 'tree', sha: 'bbb' },
        { path: 'skills/react/SKILL.md', type: 'blob', sha: 'ccc' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockTree,
    } as Response);

    const result = await fetchRepoTree('owner/repo');

    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ path: 'README.md', type: 'blob', sha: 'aaa' });
    expect(result![2]).toEqual({ path: 'skills/react/SKILL.md', type: 'blob', sha: 'ccc' });
  });

  it('falls back to master when main fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'root', tree: [{ path: 'SKILL.md', type: 'blob', sha: 'x' }] }),
    } as Response);

    const result = await fetchRepoTree('owner/repo');

    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondUrl = fetchSpy.mock.calls[1]![0] as string;
    expect(secondUrl).toContain('/master?');
  });

  it('tries ref first when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'root', tree: [{ path: 'SKILL.md', type: 'blob', sha: 'x' }] }),
    } as Response);

    await fetchRepoTree('owner/repo', 'v2');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/v2?');
  });

  it('returns null when all branches fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await fetchRepoTree('owner/repo');

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await fetchRepoTree('owner/repo');

    expect(result).toBeNull();
  });

  it('includes User-Agent header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'root', tree: [] }),
    } as Response);

    await fetchRepoTree('owner/repo');

    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('dotai');
  });
});
