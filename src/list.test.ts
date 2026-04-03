import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';
import { shortenPath } from './utils.ts';

describe('list command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -g flag', () => {
      const options = parseListOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseListOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -a flag with single agent', () => {
      const options = parseListOptions(['-a', 'claude-code']);
      expect(options.targets).toEqual(['claude-code']);
    });

    it('should parse --targets flag with single agent', () => {
      const options = parseListOptions(['--targets', 'cursor']);
      expect(options.targets).toEqual(['cursor']);
    });

    it('should parse -a flag with multiple agents', () => {
      const options = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
      expect(options.targets).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-a', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.targets).toEqual(['claude-code', 'cursor']);
    });

    it('should stop collecting agents at next flag', () => {
      const options = parseListOptions(['-a', 'claude-code', '-g']);
      expect(options.targets).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });

    it('should parse --type with single value', () => {
      const options = parseListOptions(['--type', 'instruction']);
      expect(options.type).toEqual(['instruction']);
    });

    it('should parse -t short flag', () => {
      const options = parseListOptions(['-t', 'skill']);
      expect(options.type).toEqual(['skill']);
    });

    it('should parse --type with prompt value', () => {
      const options = parseListOptions(['--type', 'prompt']);
      expect(options.type).toEqual(['prompt']);
    });

    it('should parse multiple --type flags', () => {
      const options = parseListOptions(['--type', 'skill', '--type', 'instruction']);
      expect(options.type).toEqual(['skill', 'instruction']);
    });

    it('should parse comma-separated --type values', () => {
      const options = parseListOptions(['--type', 'instruction,prompt']);
      expect(options.type).toEqual(['instruction', 'prompt']);
    });

    it('should parse comma-separated --type with all four types', () => {
      const options = parseListOptions(['-t', 'skill,instruction,prompt,agent']);
      expect(options.type).toEqual(['skill', 'instruction', 'prompt', 'agent']);
    });

    it('should deduplicate comma-separated --type values', () => {
      const options = parseListOptions(['--type', 'instruction,instruction,prompt']);
      expect(options.type).toEqual(['instruction', 'prompt']);
    });

    it('should deduplicate across repeated flags and comma values', () => {
      const options = parseListOptions(['--type', 'instruction,prompt', '--type', 'instruction']);
      expect(options.type).toEqual(['instruction', 'prompt']);
    });

    it('should parse --type with other flags', () => {
      const options = parseListOptions(['-g', '--type', 'instruction', '-a', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.type).toEqual(['instruction']);
      expect(options.targets).toEqual(['cursor']);
    });

    it('should parse --type with other flags', () => {
      const options = parseListOptions(['-g', '--type', 'instruction', '-a', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.type).toEqual(['instruction']);
      expect(options.targets).toEqual(['cursor']);
    });

    it('should normalize --type values to lowercase', () => {
      const options = parseListOptions(['--type', 'INSTRUCTION']);
      expect(options.type).toEqual(['instruction']);
    });

    it('should normalize mixed-case comma-separated --type values', () => {
      const options = parseListOptions(['--type', 'Instruction,PROMPT,Agent']);
      expect(options.type).toEqual(['instruction', 'prompt', 'agent']);
    });

    it('should filter empty segments from comma-separated --type', () => {
      const options = parseListOptions(['--type', 'instruction,,prompt']);
      expect(options.type).toEqual(['instruction', 'prompt']);
    });

    it('should combine -g with --type agent', () => {
      const options = parseListOptions(['-g', '--type', 'agent']);
      expect(options.global).toBe(true);
      expect(options.type).toEqual(['agent']);
    });

    it('should return empty agent array for -a with no following values', () => {
      const options = parseListOptions(['-a']);
      expect(options.targets).toEqual([]);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      // Empty project dir shows "No project context found"
      expect(result.stdout).toContain('No project');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No project');
      expect(result.exitCode).toBe(0);
    });

    it('should show message when no project skills found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project');
      expect(result.exitCode).toBe(0);
    });

    it('should list project skills', () => {
      // Create a skill in the canonical location
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for listing
---

# Test Skill

This is a test skill.
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Skills');
      // Description should not be shown
      expect(result.stdout).not.toContain('A test skill for listing');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple skills', () => {
      // Create multiple skills
      const skill1Dir = join(testDir, '.agents', 'skills', 'skill-one');
      const skill2Dir = join(testDir, '.agents', 'skills', 'skill-two');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
description: First skill
---
# Skill One
`
      );

      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
description: Second skill
---
# Skill Two
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      // Create a project skill (should not be shown with -g)
      const skillDir = join(testDir, '.agents', 'skills', 'project-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: project-skill
description: A project skill
---
# Project Skill
`
      );

      const result = runCli(['list', '-g'], testDir);
      // Should not show project skill when -g is specified
      expect(result.stdout).not.toContain('project-skill');
      expect(result.stdout).toContain('Global');
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid targets');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      // Create a skill
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      // Create a valid skill
      const validDir = join(testDir, '.agents', 'skills', 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      // Create an invalid directory (no SKILL.md)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a skill');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should handle SKILL.md with missing frontmatter', () => {
      // Create a valid skill
      const validDir = join(testDir, '.agents', 'skills', 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      // Create a skill with invalid SKILL.md (no frontmatter)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should show skill path', () => {
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      const result = runCli(['list'], testDir);
      // Path is shown inline with skill name (handles both Unix / and Windows \)
      expect(result.stdout).toMatch(/\.agents[/\\]skills[/\\]test-skill/);
    });

    it('should show error for invalid --type value', () => {
      const result = runCli(['list', '--type', 'invalid'], testDir);
      expect(result.stdout).toContain('Invalid type: invalid');
      expect(result.stdout).toContain('Valid types: skill, prompt, agent, instruction');
      expect(result.exitCode).toBe(1);
    });

    it('should show error for invalid value in comma-separated --type', () => {
      const result = runCli(['list', '--type', 'instruction,invalid'], testDir);
      expect(result.stdout).toContain('Invalid type: invalid');
      expect(result.exitCode).toBe(1);
    });

    it('should show error when --type has no value', () => {
      const result = runCli(['list', '--type'], testDir);
      expect(result.stdout).toContain('--type requires a value');
      expect(result.exitCode).toBe(1);
    });

    it('should show only skills with --type skill', () => {
      // Create a skill
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      // Create a .dotai-lock.json with an instruction
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'code-style',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot', 'claude-code'],
              hash: 'abc123',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: ['.github/instructions/code-style.instructions.md'],
            },
          ],
        })
      );

      const result = runCli(['list', '--type', 'skill'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Skills');
      expect(result.stdout).not.toContain('Instructions');
      expect(result.stdout).not.toContain('code-style');
      expect(result.exitCode).toBe(0);
    });

    it('should show instructions with agent display names', () => {
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'testing-guidelines',
              source: 'test/repo',
              format: 'canonical',
              agents: ['cursor', 'opencode'],
              hash: 'def456',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('testing-guidelines');
      expect(result.stdout).toContain('Cursor');
      expect(result.stdout).toContain('OpenCode');
      expect(result.exitCode).toBe(0);
    });

    it('should show both skills and instructions by default', () => {
      // Create a skill
      const skillDir = join(testDir, '.agents', 'skills', 'my-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: my-skill
description: A skill
---
# My Skill
`
      );

      // Create a .dotai-lock.json with an instruction
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'my-instruction',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'ghi789',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('Skills');
      expect(result.stdout).toContain('my-skill');
      expect(result.stdout).toContain('Instructions');
      expect(result.stdout).toContain('my-instruction');
      expect(result.exitCode).toBe(0);
    });

    it('should show no instructions section when no instructions are installed', () => {
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).not.toContain('Instructions');
      expect(result.exitCode).toBe(0);
    });

    it('should filter instructions by agent', () => {
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'cursor-instruction',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['cursor'],
              hash: 'aaa',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'instruction',
              name: 'opencode-instruction',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['opencode'],
              hash: 'bbb',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list', '-t', 'instruction', '-a', 'cursor'], testDir);
      expect(result.stdout).toContain('cursor-instruction');
      expect(result.stdout).not.toContain('opencode-instruction');
      expect(result.exitCode).toBe(0);
    });

    it('should show dim note about instructions when using -g with project instructions', () => {
      // Create a global skill so there's output
      const globalSkillDir = join(homedir(), '.agents', 'skills', 'global-test-skill-list');
      mkdirSync(globalSkillDir, { recursive: true });
      writeFileSync(
        join(globalSkillDir, 'SKILL.md'),
        `---
name: global-test-skill-list
description: A global test skill
---
# Global Test Skill
`
      );

      // Create a .dotai-lock.json with an instruction in the project
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'project-instruction',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['cursor'],
              hash: 'xyz',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      try {
        const result = runCli(['list', '-g'], testDir);
        expect(result.stdout).toContain('project-scoped');
        expect(result.stdout).not.toContain('project-instruction');
        expect(result.exitCode).toBe(0);
      } finally {
        // Clean up the global skill we created
        rmSync(globalSkillDir, { recursive: true, force: true });
      }
    });
    it('should show only prompts with --type prompt', () => {
      // Create a .dotai-lock.json with an instruction and a prompt
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'code-style',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'abc123',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'prompt',
              name: 'review-code',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot', 'claude-code'],
              hash: 'def456',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list', '--type', 'prompt'], testDir);
      expect(result.stdout).toContain('review-code');
      expect(result.stdout).toContain('Prompts');
      expect(result.stdout).not.toContain('Instructions');
      expect(result.stdout).not.toContain('code-style');
      expect(result.exitCode).toBe(0);
    });

    it('should show prompts alongside instructions by default', () => {
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'instruction',
              name: 'my-instruction',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['cursor'],
              hash: 'aaa',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'prompt',
              name: 'my-prompt',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'bbb',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('Instructions');
      expect(result.stdout).toContain('my-instruction');
      expect(result.stdout).toContain('Prompts');
      expect(result.stdout).toContain('my-prompt');
      expect(result.exitCode).toBe(0);
    });

    it('should show empty state for --type prompt with no prompts', () => {
      const result = runCli(['list', '--type', 'prompt'], testDir);
      expect(result.stdout).toContain('No project prompts found');
      expect(result.exitCode).toBe(0);
    });

    it('should filter prompts by agent', () => {
      writeFileSync(
        join(testDir, '.dotai-lock.json'),
        JSON.stringify({
          version: 1,
          items: [
            {
              type: 'prompt',
              name: 'copilot-prompt',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['github-copilot'],
              hash: 'aaa',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
            {
              type: 'prompt',
              name: 'claude-prompt',
              source: 'owner/repo',
              format: 'canonical',
              agents: ['claude-code'],
              hash: 'bbb',
              installedAt: '2025-01-01T00:00:00.000Z',
              outputs: [],
            },
          ],
        })
      );

      const result = runCli(['list', '-t', 'prompt', '-a', 'github-copilot'], testDir);
      expect(result.stdout).toContain('copilot-prompt');
      expect(result.stdout).not.toContain('claude-prompt');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed context');
    });

    it('should include list options in list --help', () => {
      const result = runCli(['list', '--help']);
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-a, --targets');
      expect(result.stdout).toContain('-t, --type');
    });

    it('should include list examples in list --help', () => {
      const result = runCli(['list', '--help']);
      expect(result.stdout).toContain('dotai list');
      expect(result.stdout).toContain('dotai ls -g');
      expect(result.stdout).toContain('dotai ls -a claude-code');
      expect(result.stdout).toContain('dotai ls -t prompt');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx dotai list');
      expect(result.stdout).toContain('List installed context');
    });
  });

  describe('shortenPath', () => {
    const home = homedir();

    it('should replace homedir with ~', () => {
      const result = shortenPath(`${home}/projects/dotai`, '/cwd');
      expect(result).toBe('~/projects/dotai');
    });

    it('should not match paths that share a prefix with homedir', () => {
      // e.g. home=/home/user should NOT match /home/user2/projects
      const result = shortenPath(`${home}2/projects/dotai`, '/cwd');
      expect(result).toBe(`${home}2/projects/dotai`);
    });

    it('should handle exact homedir path', () => {
      const result = shortenPath(home, '/cwd');
      expect(result).toBe('~');
    });

    it('should replace cwd with .', () => {
      const cwd = '/some/project/dir';
      const result = shortenPath(`${cwd}/src/file.ts`, cwd);
      expect(result).toBe('./src/file.ts');
    });

    it('should not match paths that share a prefix with cwd', () => {
      const cwd = '/some/project';
      // /some/project-other/file should NOT be shortened
      const result = shortenPath(`${cwd}-other/file.ts`, cwd);
      expect(result).toBe(`${cwd}-other/file.ts`);
    });

    it('should handle exact cwd path', () => {
      const cwd = '/some/project';
      const result = shortenPath(cwd, cwd);
      expect(result).toBe('.');
    });

    it('should return path unchanged when no prefix matches', () => {
      const result = shortenPath('/other/path/file.ts', '/cwd');
      expect(result).toBe('/other/path/file.ts');
    });
  });
});
