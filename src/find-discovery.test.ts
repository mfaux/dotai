import { describe, it, expect } from 'vitest';
import { discoverRemoteContext } from './find-discovery.ts';
import type { GitHubTreeEntry } from './lib/git/index.ts';

function blob(path: string): GitHubTreeEntry {
  return { path, type: 'blob', sha: 'abc123' };
}

function tree(path: string): GitHubTreeEntry {
  return { path, type: 'tree', sha: 'abc123' };
}

describe('discoverRemoteContext', () => {
  // -----------------------------------------------------------------------
  // Canonical patterns
  // -----------------------------------------------------------------------

  it('discovers skills in skills/ directory', () => {
    const entries = [blob('skills/react-best-practices/SKILL.md'), blob('README.md')];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toEqual({
      name: 'react-best-practices',
      path: 'skills/react-best-practices/SKILL.md',
      type: 'skill',
    });
  });

  it('discovers root-level SKILL.md using repo name', () => {
    const entries = [blob('SKILL.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.name).toBe('my-repo');
  });

  it('falls back to "root" when no repo name given', () => {
    const entries = [blob('SKILL.md')];
    const result = discoverRemoteContext(entries);

    expect(result.skills[0]!.name).toBe('root');
  });

  it('discovers all context types', () => {
    const entries = [
      blob('skills/react/SKILL.md'),
      blob('prompts/review-code/PROMPT.md'),
      blob('agents/reviewer/AGENT.md'),
      blob('INSTRUCTIONS.md'),
    ];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.instructions).toHaveLength(1);

    expect(result.prompts[0]!.name).toBe('review-code');
    expect(result.agents[0]!.name).toBe('reviewer');
    expect(result.instructions[0]!.name).toBe('my-repo');
  });

  it('discovers root-level items for all types', () => {
    const entries = [
      blob('SKILL.md'),
      blob('PROMPT.md'),
      blob('AGENT.md'),
      blob('INSTRUCTIONS.md'),
    ];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.instructions).toHaveLength(1);

    for (const list of [result.skills, result.prompts, result.agents, result.instructions]) {
      expect(list[0]!.name).toBe('my-repo');
    }
  });

  it('discovers multiple skills', () => {
    const entries = [
      blob('skills/react/SKILL.md'),
      blob('skills/nextjs/SKILL.md'),
      blob('skills/typescript/SKILL.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(3);
    expect(result.skills.map((s) => s.name).sort()).toEqual(['nextjs', 'react', 'typescript']);
  });

  it('ignores tree entries (directories)', () => {
    const entries = [tree('skills/react'), blob('skills/react/SKILL.md')];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(1);
  });

  it('ignores non-matching files', () => {
    const entries = [
      blob('README.md'),
      blob('package.json'),
      blob('src/index.ts'),
      blob('skills/react/README.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
    expect(result.instructions).toHaveLength(0);
  });

  it('handles empty tree', () => {
    const result = discoverRemoteContext([]);

    expect(result.skills).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
    expect(result.instructions).toHaveLength(0);
  });

  it('ignores deeply nested context files', () => {
    const entries = [blob('src/skills/react/SKILL.md'), blob('foo/prompts/bar/PROMPT.md')];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
  });

  it('handles mixed root and directory items', () => {
    const entries = [
      blob('SKILL.md'),
      blob('skills/react/SKILL.md'),
      blob('PROMPT.md'),
      blob('prompts/review-code/PROMPT.md'),
    ];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(2);
    expect(result.prompts).toHaveLength(2);
    expect(result.skills.map((s) => s.name).sort()).toEqual(['my-repo', 'react']);
    expect(result.prompts.map((p) => p.name).sort()).toEqual(['my-repo', 'review-code']);
  });

  // -----------------------------------------------------------------------
  // Canonical INSTRUCTIONS.md patterns
  // -----------------------------------------------------------------------

  it('discovers root-level INSTRUCTIONS.md', () => {
    const entries = [blob('INSTRUCTIONS.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]).toEqual({
      name: 'my-repo',
      path: 'INSTRUCTIONS.md',
      type: 'instruction',
    });
  });

  it('falls back to "root" for INSTRUCTIONS.md when no repo name given', () => {
    const entries = [blob('INSTRUCTIONS.md')];
    const result = discoverRemoteContext(entries);

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]!.name).toBe('root');
  });

  it('ignores INSTRUCTIONS.md in subdirectories', () => {
    const entries = [
      blob('instructions/sub/INSTRUCTIONS.md'),
      blob('src/INSTRUCTIONS.md'),
      blob('docs/INSTRUCTIONS.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.instructions).toHaveLength(0);
  });

  it('INSTRUCTIONS.md does not have native field', () => {
    const entries = [blob('INSTRUCTIONS.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.instructions[0]!.native).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Native agent-specific patterns
  // -----------------------------------------------------------------------

  it('discovers Claude Code native prompts and agents', () => {
    const entries = [blob('.claude/commands/deploy.md'), blob('.claude/agents/reviewer.md')];
    const result = discoverRemoteContext(entries);

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({
      name: 'deploy',
      type: 'prompt',
      native: 'claude-code',
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: 'reviewer',
      type: 'agent',
      native: 'claude-code',
    });
  });

  it('discovers GitHub Copilot native prompts and agents', () => {
    const entries = [
      blob('.github/prompts/review.prompt.md'),
      blob('.github/agents/security.agent.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({
      name: 'review',
      type: 'prompt',
      native: 'github-copilot',
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: 'security',
      type: 'agent',
      native: 'github-copilot',
    });
  });

  it('mixes canonical and native prompts', () => {
    const entries = [
      blob('prompts/review-code/PROMPT.md'),
      blob('.claude/commands/deploy.md'),
      blob('.github/prompts/review.prompt.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.prompts).toHaveLength(3);

    const canonical = result.prompts.filter((p) => !p.native);
    const native = result.prompts.filter((p) => p.native);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]!.name).toBe('review-code');
    expect(native).toHaveLength(2);
    expect(native.map((p) => p.native).sort()).toEqual(['claude-code', 'github-copilot']);
  });

  it('ignores native files in subdirectories', () => {
    const entries = [blob('.claude/commands/nested/deep.md'), blob('.claude/agents/sub/dir.md')];
    const result = discoverRemoteContext(entries);

    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
  });

  it('canonical items do not have native field', () => {
    const entries = [blob('prompts/review/PROMPT.md'), blob('SKILL.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.prompts[0]!.native).toBeUndefined();
    expect(result.skills[0]!.native).toBeUndefined();
  });
});
