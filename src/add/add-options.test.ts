import { describe, it, expect } from 'vitest';
import { parseAddOptions } from './add-options.ts';
import { resolveTargetAgents } from '../lib/install/index.ts';

// ---------------------------------------------------------------------------
// parseAddOptions — basic flags
// ---------------------------------------------------------------------------

describe('parseAddOptions — basic flags', () => {
  it('parses --targets comma-separated', () => {
    const { options } = parseAddOptions(['owner/repo', '--targets', 'copilot,claude,cursor']);
    expect(options.targets).toEqual(['copilot', 'claude', 'cursor']);
  });

  it('parses --targets space-separated', () => {
    const { options } = parseAddOptions(['owner/repo', '--targets', 'copilot', 'claude']);
    expect(options.targets).toEqual(['copilot', 'claude']);
  });

  it('parses --dry-run flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--prompt', 'review-code', '--dry-run']);
    expect(options.dryRun).toBe(true);
  });

  it('parses --force flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--prompt', 'review-code', '--force']);
    expect(options.force).toBe(true);
  });

  it('parses combined prompt + targets + dry-run + force flags', () => {
    const { source, options } = parseAddOptions([
      'owner/repo',
      '--prompt',
      'review-code',
      '--targets',
      'copilot,claude',
      '--dry-run',
      '--force',
    ]);
    expect(source).toEqual(['owner/repo']);
    expect(options.prompt).toEqual(['review-code']);
    expect(options.targets).toEqual(['copilot', 'claude']);
    expect(options.dryRun).toBe(true);
    expect(options.force).toBe(true);
  });

  it('parses --prompt and --skill together', () => {
    const { options } = parseAddOptions([
      'owner/repo',
      '--prompt',
      'review-code',
      '--skill',
      'my-skill',
    ]);
    expect(options.prompt).toEqual(['review-code']);
    expect(options.skill).toEqual(['my-skill']);
  });

  it('treats unrecognized args as source', () => {
    const { source, options } = parseAddOptions(['owner/repo']);
    expect(source).toEqual(['owner/repo']);
    expect(options.targets).toBeUndefined();
    expect(options.dryRun).toBeUndefined();
    expect(options.force).toBeUndefined();
  });

  it('parses --gitignore flag', () => {
    const { options } = parseAddOptions(['owner/repo', '--prompt', 'review-code', '--gitignore']);
    expect(options.gitignore).toBe(true);
  });

  it('--gitignore defaults to undefined when not specified', () => {
    const { options } = parseAddOptions(['owner/repo', '--prompt', 'review-code']);
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
