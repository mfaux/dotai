import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  riskLabel,
  socketLabel,
  padEnd,
  buildSecurityLines,
  splitAgentsByType,
  buildAgentSummaryLines,
  ensureUniversalAgents,
  buildResultLines,
} from './add-display.ts';
import type { AgentType } from './types.ts';
import type { AuditResponse, PartnerAudit } from './telemetry.ts';

// Helper to strip ANSI escape codes for easier assertion
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('riskLabel', () => {
  it('returns colored label for critical risk', () => {
    const result = riskLabel('critical');
    expect(stripAnsi(result)).toBe('Critical Risk');
  });

  it('returns colored label for high risk', () => {
    const result = riskLabel('high');
    expect(stripAnsi(result)).toBe('High Risk');
  });

  it('returns colored label for medium risk', () => {
    const result = riskLabel('medium');
    expect(stripAnsi(result)).toBe('Med Risk');
  });

  it('returns colored label for low risk', () => {
    const result = riskLabel('low');
    expect(stripAnsi(result)).toBe('Low Risk');
  });

  it('returns colored label for safe', () => {
    const result = riskLabel('safe');
    expect(stripAnsi(result)).toBe('Safe');
  });

  it('returns dim dash for unknown risk', () => {
    const result = riskLabel('unknown');
    expect(stripAnsi(result)).toBe('--');
  });
});

describe('socketLabel', () => {
  it('returns dim dash for undefined audit', () => {
    const result = socketLabel(undefined);
    expect(stripAnsi(result)).toBe('--');
  });

  it('returns green 0 alerts when no alerts', () => {
    const audit: PartnerAudit = { risk: 'safe', alerts: 0, analyzedAt: '2024-01-01' };
    const result = socketLabel(audit);
    expect(stripAnsi(result)).toBe('0 alerts');
  });

  it('returns red alert count for single alert', () => {
    const audit: PartnerAudit = { risk: 'high', alerts: 1, analyzedAt: '2024-01-01' };
    const result = socketLabel(audit);
    expect(stripAnsi(result)).toBe('1 alert');
  });

  it('returns red alert count for multiple alerts', () => {
    const audit: PartnerAudit = { risk: 'high', alerts: 3, analyzedAt: '2024-01-01' };
    const result = socketLabel(audit);
    expect(stripAnsi(result)).toBe('3 alerts');
  });

  it('returns green 0 alerts when alerts field is undefined', () => {
    const audit: PartnerAudit = { risk: 'safe', analyzedAt: '2024-01-01' };
    const result = socketLabel(audit);
    expect(stripAnsi(result)).toBe('0 alerts');
  });
});

describe('padEnd', () => {
  it('pads a plain string to the target width', () => {
    const result = padEnd('hi', 6);
    expect(result).toBe('hi    ');
  });

  it('does not pad when string is already at target width', () => {
    const result = padEnd('hello', 5);
    expect(result).toBe('hello');
  });

  it('does not truncate when string exceeds target width', () => {
    const result = padEnd('longer', 3);
    expect(result).toBe('longer');
  });

  it('ignores ANSI escape codes when measuring visible length', () => {
    const ansiStr = '\x1b[31mhi\x1b[0m'; // "hi" in red
    const result = padEnd(ansiStr, 6);
    // visible "hi" = 2 chars, needs 4 more spaces
    expect(result).toBe(ansiStr + '    ');
  });

  it('handles empty string', () => {
    const result = padEnd('', 4);
    expect(result).toBe('    ');
  });
});

describe('buildSecurityLines', () => {
  const skills = [
    { slug: 'skill-a', displayName: 'Skill A' },
    { slug: 'skill-b', displayName: 'Skill B' },
  ];
  const source = 'owner/repo';

  it('returns empty array when auditData is null', () => {
    expect(buildSecurityLines(null, skills, source)).toEqual([]);
  });

  it('returns empty array when no skills have audit data', () => {
    const audit: AuditResponse = {};
    expect(buildSecurityLines(audit, skills, source)).toEqual([]);
  });

  it('returns empty array when all skill audit data objects are empty', () => {
    const audit: AuditResponse = { 'skill-a': {}, 'skill-b': {} };
    expect(buildSecurityLines(audit, skills, source)).toEqual([]);
  });

  it('returns header + rows + footer when audit data exists', () => {
    const audit: AuditResponse = {
      'skill-a': {
        ath: { risk: 'low', analyzedAt: '2024-01-01' },
        socket: { risk: 'safe', alerts: 0, analyzedAt: '2024-01-01' },
        snyk: { risk: 'medium', analyzedAt: '2024-01-01' },
      },
    };
    const lines = buildSecurityLines(audit, skills, source);
    // Header line + 2 skill rows + empty line + footer = 5 lines
    expect(lines.length).toBe(5);
    // Header contains column names
    expect(stripAnsi(lines[0]!)).toContain('Gen');
    expect(stripAnsi(lines[0]!)).toContain('Socket');
    expect(stripAnsi(lines[0]!)).toContain('Snyk');
    // Skill A row has data
    expect(stripAnsi(lines[1]!)).toContain('Skill A');
    expect(stripAnsi(lines[1]!)).toContain('Low Risk');
    expect(stripAnsi(lines[1]!)).toContain('0 alerts');
    expect(stripAnsi(lines[1]!)).toContain('Med Risk');
    // Skill B row has dashes (no data)
    expect(stripAnsi(lines[2]!)).toContain('Skill B');
    expect(stripAnsi(lines[2]!)).toContain('--');
    // Empty line
    expect(lines[3]).toBe('');
    // Footer
    expect(stripAnsi(lines[4]!)).toContain('https://skills.sh/owner/repo');
  });

  it('truncates long display names with ellipsis', () => {
    const longSkills = [{ slug: 'long', displayName: 'A'.repeat(40) }];
    const audit: AuditResponse = {
      long: { ath: { risk: 'safe', analyzedAt: '2024-01-01' } },
    };
    const lines = buildSecurityLines(audit, longSkills, source);
    // Name should be truncated at 36 chars (max column width)
    const row = stripAnsi(lines[1]!);
    expect(row).toContain('\u2026'); // ellipsis character
  });
});

describe('splitAgentsByType', () => {
  it('splits agents into universal and symlinked groups', () => {
    // codex uses .agents/skills (universal), claude-code uses .claude/skills (non-universal)
    const result = splitAgentsByType(['codex', 'claude-code'] as AgentType[]);
    expect(result.universal.length).toBe(1);
    expect(result.symlinked.length).toBe(1);
  });

  it('returns empty arrays for empty input', () => {
    const result = splitAgentsByType([]);
    expect(result.universal).toEqual([]);
    expect(result.symlinked).toEqual([]);
  });

  it('puts all universal agents in the universal group', () => {
    // codex and opencode both use .agents/skills (universal)
    const result = splitAgentsByType(['codex', 'opencode'] as AgentType[]);
    expect(result.universal.length).toBe(2);
    expect(result.symlinked.length).toBe(0);
  });

  it('puts non-universal agents in the symlinked group', () => {
    // claude-code uses .claude/skills (non-universal), cursor uses .agents/skills (universal)
    const result = splitAgentsByType(['cursor', 'claude-code'] as AgentType[]);
    expect(result.universal.length).toBe(1);
    expect(result.symlinked.length).toBe(1);
  });
});

describe('buildAgentSummaryLines', () => {
  it('shows universal and symlink lines in symlink mode', () => {
    // codex is universal (.agents/skills), claude-code is non-universal (.claude/skills)
    const agentList: AgentType[] = ['codex', 'claude-code'];
    const lines = buildAgentSummaryLines(agentList, 'symlink');
    const text = lines.map(stripAnsi).join('\n');
    expect(text).toContain('universal:');
    expect(text).toContain('symlink');
  });

  it('shows copy line in copy mode', () => {
    const agentList: AgentType[] = ['codex', 'claude-code'];
    const lines = buildAgentSummaryLines(agentList, 'copy');
    const text = lines.map(stripAnsi).join('\n');
    expect(text).toContain('copy');
  });

  it('returns empty array when no agents', () => {
    const lines = buildAgentSummaryLines([], 'symlink');
    expect(lines).toEqual([]);
  });
});

describe('ensureUniversalAgents', () => {
  it('adds missing universal agents', () => {
    // claude-code is non-universal; universal agents should be added
    const result = ensureUniversalAgents(['claude-code'] as AgentType[]);
    // Should include claude-code plus all universal agents
    expect(result).toContain('claude-code');
    expect(result.length).toBeGreaterThan(1);
  });

  it('does not duplicate already-included universal agents', () => {
    const result = ensureUniversalAgents(['codex'] as AgentType[]);
    const codexCount = result.filter((a: AgentType) => a === 'codex').length;
    expect(codexCount).toBe(1);
  });

  it('handles empty input', () => {
    const result = ensureUniversalAgents([]);
    // Should return all universal agents
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('buildResultLines', () => {
  it('groups results by universal, symlinked, and copied', () => {
    const results = [
      { agent: 'Codex', symlinkFailed: false },
      { agent: 'Claude Code', symlinkFailed: false },
      { agent: 'Claude Code', symlinkFailed: true },
    ];
    // codex is universal (.agents/skills), claude-code is non-universal (.claude/skills)
    const targetAgents: AgentType[] = ['codex', 'claude-code', 'claude-code'];
    const lines = buildResultLines(results, targetAgents);
    const text = lines.map(stripAnsi).join('\n');
    expect(text).toContain('universal:');
    expect(text).toContain('symlinked:');
    expect(text).toContain('copied:');
  });

  it('omits groups with no members', () => {
    // claude-code is non-universal, so it should appear in symlinked group only
    const results = [{ agent: 'Claude Code', symlinkFailed: false }];
    const targetAgents: AgentType[] = ['claude-code'];
    const lines = buildResultLines(results, targetAgents);
    const text = lines.map(stripAnsi).join('\n');
    expect(text).not.toContain('universal:');
    expect(text).toContain('symlinked:');
    expect(text).not.toContain('copied:');
  });

  it('returns empty lines for empty results', () => {
    const lines = buildResultLines([], []);
    expect(lines).toEqual([]);
  });
});
