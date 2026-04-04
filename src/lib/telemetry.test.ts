import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setVersion, track, fetchAuditData } from './telemetry.ts';

// ---------------------------------------------------------------------------
// setVersion / track / fetchAuditData
// ---------------------------------------------------------------------------

describe('setVersion', () => {
  it('does not throw', () => {
    expect(() => setVersion('1.2.3')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// track — telemetry is disabled (TELEMETRY_URL is null), so track() should
// always short-circuit without making any fetch calls.
// ---------------------------------------------------------------------------

describe('track', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not throw when called with valid data', () => {
    expect(() =>
      track({
        event: 'install',
        source: 'owner/repo',
        skills: 'my-skill',
        agents: 'cursor',
      })
    ).not.toThrow();
  });

  it('does not throw when DISABLE_TELEMETRY is set', () => {
    process.env.DISABLE_TELEMETRY = '1';
    expect(() =>
      track({
        event: 'find',
        query: 'react',
        resultCount: '5',
      })
    ).not.toThrow();
  });

  it('does not throw when DO_NOT_TRACK is set', () => {
    process.env.DO_NOT_TRACK = '1';
    expect(() =>
      track({
        event: 'find',
        query: 'react',
        resultCount: '5',
      })
    ).not.toThrow();
  });

  it('handles all event types without throwing', () => {
    const events = [
      { event: 'install' as const, source: 's', skills: 'k', agents: 'a' },
      { event: 'remove' as const, skills: 'k', agents: 'a' },
      { event: 'check' as const, skillCount: '1', updatesAvailable: '0' },
      { event: 'check-rules' as const, ruleCount: '1', updatesAvailable: '0' },
      { event: 'update' as const, skillCount: '1', successCount: '1', failCount: '0' },
      { event: 'update-rules' as const, ruleCount: '1', successCount: '1', failCount: '0' },
      { event: 'find' as const, query: 'q', resultCount: '1' },
      {
        event: 'experimental_sync' as const,
        skillCount: '1',
        successCount: '1',
        agents: 'cursor',
      },
    ];

    for (const data of events) {
      expect(() => track(data)).not.toThrow();
    }
  });

  it('does not call fetch (telemetry URL is null)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    track({
      event: 'install',
      source: 'owner/repo',
      skills: 'my-skill',
      agents: 'cursor',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// fetchAuditData — AUDIT_URL is null, so all calls should return null.
// ---------------------------------------------------------------------------

describe('fetchAuditData', () => {
  it('returns null when AUDIT_URL is disabled', async () => {
    const result = await fetchAuditData('owner/repo', ['skill-a', 'skill-b']);
    expect(result).toBeNull();
  });

  it('returns null for empty skill slugs', async () => {
    const result = await fetchAuditData('owner/repo', []);
    expect(result).toBeNull();
  });

  it('does not call fetch when AUDIT_URL is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await fetchAuditData('owner/repo', ['skill-a']);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
