import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatInstalls, searchSkillsAPI } from './find.ts';

// ---------------------------------------------------------------------------
// formatInstalls
// ---------------------------------------------------------------------------

describe('formatInstalls', () => {
  it('returns empty string for 0', () => {
    expect(formatInstalls(0)).toBe('');
  });

  it('returns empty string for negative numbers', () => {
    expect(formatInstalls(-5)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(formatInstalls(NaN)).toBe('');
  });

  it('returns "1 install" (singular) for 1', () => {
    expect(formatInstalls(1)).toBe('1 install');
  });

  it('returns "2 installs" (plural) for 2', () => {
    expect(formatInstalls(2)).toBe('2 installs');
  });

  it('returns "999 installs" for 999', () => {
    expect(formatInstalls(999)).toBe('999 installs');
  });

  it('formats thousands with K suffix', () => {
    expect(formatInstalls(1_000)).toBe('1K installs');
    expect(formatInstalls(1_500)).toBe('1.5K installs');
    expect(formatInstalls(10_000)).toBe('10K installs');
    expect(formatInstalls(999_999)).toBe('1000K installs');
  });

  it('removes trailing .0 in K format', () => {
    expect(formatInstalls(2_000)).toBe('2K installs');
    expect(formatInstalls(50_000)).toBe('50K installs');
  });

  it('formats millions with M suffix', () => {
    expect(formatInstalls(1_000_000)).toBe('1M installs');
    expect(formatInstalls(2_500_000)).toBe('2.5M installs');
    expect(formatInstalls(10_000_000)).toBe('10M installs');
  });

  it('removes trailing .0 in M format', () => {
    expect(formatInstalls(3_000_000)).toBe('3M installs');
  });
});

// ---------------------------------------------------------------------------
// searchSkillsAPI
// ---------------------------------------------------------------------------

describe('searchSkillsAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed skills from the API', async () => {
    const mockResponse = {
      skills: [
        {
          id: 'react-best-practices',
          name: 'react-best-practices',
          installs: 1200,
          source: 'vercel-labs/agent-skills',
        },
        { id: 'typescript-style', name: 'typescript-style', installs: 500, source: 'acme/repo' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await searchSkillsAPI('react');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      name: 'react-best-practices',
      slug: 'react-best-practices',
      source: 'vercel-labs/agent-skills',
      installs: 1200,
    });
    expect(results[1]).toEqual({
      name: 'typescript-style',
      slug: 'typescript-style',
      source: 'acme/repo',
      installs: 500,
    });
  });

  it('returns empty array when API returns non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const results = await searchSkillsAPI('react');
    expect(results).toEqual([]);
  });

  it('returns empty array when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const results = await searchSkillsAPI('react');
    expect(results).toEqual([]);
  });

  it('returns empty array when fetch times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'TimeoutError')
    );

    const results = await searchSkillsAPI('react');
    expect(results).toEqual([]);
  });

  it('handles skills without source field', async () => {
    const mockResponse = {
      skills: [{ id: 'my-skill', name: 'my-skill', installs: 10, source: '' }],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await searchSkillsAPI('my');
    expect(results[0]!.source).toBe('');
  });

  it('encodes query parameter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ skills: [] }),
    } as Response);

    await searchSkillsAPI('react hooks & state');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('q=react%20hooks%20%26%20state');
  });
});
