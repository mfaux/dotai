import { describe, it, expect } from 'vitest';
import { parseAddOptions } from './add-options.ts';
import { resolveTargetAgents } from './rule-add.ts';

// ---------------------------------------------------------------------------
// parseAddOptions — rule-related flags
// ---------------------------------------------------------------------------

describe('parseAddOptions — rule-related flags', () => {
  it('parses single --rule flag', () => {
    const { source, options } = parseAddOptions(['owner/repo', '--rule', 'code-style']);
    expect(source).toEqual(['owner/repo']);
    expect(options.rule).toEqual(['code-style']);
  });

  it('parses -r shorthand', () => {
    const { options } = parseAddOptions(['owner/repo', '-r', 'code-style']);
    expect(options.rule).toEqual(['code-style']);
  });

  it('parses multiple --rule flags', () => {
    const { options } = parseAddOptions([
      'owner/repo',
      '--rule',
      'code-style',
      '--rule',
      'security',
    ]);
    expect(options.rule).toEqual(['code-style', 'security']);
  });

  it('parses --rule with multiple space-separated values', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style', 'security']);
    expect(options.rule).toEqual(['code-style', 'security']);
  });

  it('parses --agents comma-separated', () => {
    const { options } = parseAddOptions(['owner/repo', '--agents', 'copilot,claude,cursor']);
    expect(options.agents).toEqual(['copilot', 'claude', 'cursor']);
  });

  it('parses --agents space-separated', () => {
    const { options } = parseAddOptions(['owner/repo', '--agents', 'copilot', 'claude']);
    expect(options.agents).toEqual(['copilot', 'claude']);
  });

  it('parses --dry-run flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style', '--dry-run']);
    expect(options.dryRun).toBe(true);
  });

  it('parses --force flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style', '--force']);
    expect(options.force).toBe(true);
  });

  it('parses combined rule + agents + dry-run + force flags', () => {
    const { source, options } = parseAddOptions([
      'owner/repo',
      '--rule',
      'code-style',
      '--agents',
      'copilot,claude',
      '--dry-run',
      '--force',
    ]);
    expect(source).toEqual(['owner/repo']);
    expect(options.rule).toEqual(['code-style']);
    expect(options.agents).toEqual(['copilot', 'claude']);
    expect(options.dryRun).toBe(true);
    expect(options.force).toBe(true);
  });

  it('parses --rule and --skill together', () => {
    const { options } = parseAddOptions([
      'owner/repo',
      '--rule',
      'code-style',
      '--skill',
      'my-skill',
    ]);
    expect(options.rule).toEqual(['code-style']);
    expect(options.skill).toEqual(['my-skill']);
  });

  it('treats unrecognized args as source', () => {
    const { source, options } = parseAddOptions(['owner/repo']);
    expect(source).toEqual(['owner/repo']);
    expect(options.rule).toBeUndefined();
    expect(options.agents).toBeUndefined();
    expect(options.dryRun).toBeUndefined();
    expect(options.force).toBeUndefined();
    expect(options.append).toBeUndefined();
  });

  it('parses --append flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style', '--append']);
    expect(options.append).toBe(true);
  });

  it('parses --append with --rule, --agents, --dry-run, --force', () => {
    const { source, options } = parseAddOptions([
      'owner/repo',
      '--rule',
      'code-style',
      '--agents',
      'copilot,claude',
      '--append',
      '--dry-run',
      '--force',
    ]);
    expect(source).toEqual(['owner/repo']);
    expect(options.rule).toEqual(['code-style']);
    expect(options.agents).toEqual(['copilot', 'claude']);
    expect(options.append).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.force).toBe(true);
  });

  it('--append defaults to undefined when not specified', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style']);
    expect(options.append).toBeUndefined();
  });

  it('parses --gitignore flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style', '--gitignore']);
    expect(options.gitignore).toBe(true);
  });

  it('--gitignore defaults to undefined when not specified', () => {
    const { options } = parseAddOptions(['owner/repo', '--rule', 'code-style']);
    expect(options.gitignore).toBeUndefined();
  });

  it('parses --gitignore with --prompt', () => {
    const { options } = parseAddOptions(['owner/repo', '--prompt', 'review-code', '--gitignore']);
    expect(options.prompt).toEqual(['review-code']);
    expect(options.gitignore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTargetAgents
// ---------------------------------------------------------------------------

describe('resolveTargetAgents', () => {
  it('resolves short alias "copilot"', () => {
    const { agents, invalid } = resolveTargetAgents(['copilot']);
    expect(agents).toEqual(['github-copilot']);
    expect(invalid).toHaveLength(0);
  });

  it('resolves short alias "claude"', () => {
    const { agents } = resolveTargetAgents(['claude']);
    expect(agents).toEqual(['claude-code']);
  });

  it('resolves full names', () => {
    const { agents } = resolveTargetAgents(['github-copilot', 'claude-code', 'cursor']);
    expect(agents).toEqual(['github-copilot', 'claude-code', 'cursor']);
  });

  it('deduplicates aliases and full names', () => {
    const { agents } = resolveTargetAgents(['copilot', 'github-copilot']);
    expect(agents).toEqual(['github-copilot']);
  });

  it('reports invalid agent names', () => {
    const { agents, invalid } = resolveTargetAgents(['copilot', 'vscode', 'sublime']);
    expect(agents).toEqual(['github-copilot']);
    expect(invalid).toEqual(['vscode', 'sublime']);
  });

  it('is case-insensitive', () => {
    const { agents } = resolveTargetAgents(['COPILOT', 'Claude', 'CURSOR']);
    expect(agents).toEqual(['github-copilot', 'claude-code', 'cursor']);
  });

  it('trims whitespace', () => {
    const { agents } = resolveTargetAgents(['  copilot  ', ' claude ']);
    expect(agents).toEqual(['github-copilot', 'claude-code']);
  });
});
