import { describe, it, expect } from 'vitest';
import { discoverRemoteContext } from './find-discovery.ts';
import type { GitHubTreeEntry } from './github-trees.ts';

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
      blob('rules/code-style/RULES.md'),
      blob('prompts/review-code/PROMPT.md'),
      blob('agents/reviewer/AGENT.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.agents).toHaveLength(1);

    expect(result.rules[0]!.name).toBe('code-style');
    expect(result.prompts[0]!.name).toBe('review-code');
    expect(result.agents[0]!.name).toBe('reviewer');
  });

  it('discovers root-level items for all types', () => {
    const entries = [blob('SKILL.md'), blob('RULES.md'), blob('PROMPT.md'), blob('AGENT.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.agents).toHaveLength(1);

    for (const list of [result.skills, result.rules, result.prompts, result.agents]) {
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
    expect(result.rules).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
  });

  it('handles empty tree', () => {
    const result = discoverRemoteContext([]);

    expect(result.skills).toHaveLength(0);
    expect(result.rules).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
  });

  it('ignores deeply nested context files', () => {
    const entries = [blob('src/skills/react/SKILL.md'), blob('foo/rules/bar/RULES.md')];
    const result = discoverRemoteContext(entries);

    expect(result.skills).toHaveLength(0);
    expect(result.rules).toHaveLength(0);
  });

  it('handles mixed root and directory items', () => {
    const entries = [
      blob('SKILL.md'),
      blob('skills/react/SKILL.md'),
      blob('RULES.md'),
      blob('rules/code-style/RULES.md'),
    ];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.skills).toHaveLength(2);
    expect(result.rules).toHaveLength(2);
    expect(result.skills.map((s) => s.name).sort()).toEqual(['my-repo', 'react']);
    expect(result.rules.map((r) => r.name).sort()).toEqual(['code-style', 'my-repo']);
  });

  // -----------------------------------------------------------------------
  // Native agent-specific patterns
  // -----------------------------------------------------------------------

  it('discovers Cursor native rules', () => {
    const entries = [blob('.cursor/rules/no-any.mdc')];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toEqual({
      name: 'no-any',
      path: '.cursor/rules/no-any.mdc',
      type: 'rule',
      native: 'cursor',
    });
  });

  it('discovers Claude Code native rules, prompts, and agents', () => {
    const entries = [
      blob('.claude/rules/code-style.md'),
      blob('.claude/commands/deploy.md'),
      blob('.claude/agents/reviewer.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      name: 'code-style',
      type: 'rule',
      native: 'claude-code',
    });

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

  it('discovers GitHub Copilot native rules, prompts, and agents', () => {
    const entries = [
      blob('.github/instructions/testing.instructions.md'),
      blob('.github/prompts/review.prompt.md'),
      blob('.github/agents/security.agent.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      name: 'testing',
      type: 'rule',
      native: 'github-copilot',
    });

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

  it('mixes canonical and native items', () => {
    const entries = [
      blob('rules/code-style/RULES.md'),
      blob('.cursor/rules/no-any.mdc'),
      blob('.claude/rules/imports.md'),
      blob('.github/instructions/testing.instructions.md'),
    ];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(4);

    const canonical = result.rules.filter((r) => !r.native);
    const native = result.rules.filter((r) => r.native);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]!.name).toBe('code-style');
    expect(native).toHaveLength(3);
    expect(native.map((r) => r.native).sort()).toEqual(['claude-code', 'cursor', 'github-copilot']);
  });

  it('ignores native files in subdirectories', () => {
    const entries = [blob('.cursor/rules/nested/deep.mdc'), blob('.claude/rules/sub/dir.md')];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(0);
  });

  it('ignores native files with wrong extension', () => {
    const entries = [
      blob('.cursor/rules/readme.txt'),
      blob('.cursor/rules/notes.md'), // .md is not .mdc for Cursor
    ];
    const result = discoverRemoteContext(entries);

    expect(result.rules).toHaveLength(0);
  });

  it('canonical items do not have native field', () => {
    const entries = [blob('rules/style/RULES.md'), blob('SKILL.md')];
    const result = discoverRemoteContext(entries, 'my-repo');

    expect(result.rules[0]!.native).toBeUndefined();
    expect(result.skills[0]!.native).toBeUndefined();
  });
});
