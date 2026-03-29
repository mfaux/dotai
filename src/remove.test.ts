import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliWithInput } from './test-utils.js';
import { parseRemoveOptions, removeCommand } from './remove.ts';
import { CommandError } from './command-result.ts';

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual('@clack/prompts');
  return {
    ...actual,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    confirm: vi.fn(),
    multiselect: vi.fn(),
    spinner: () => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    }),
    log: {
      info: vi.fn(),
      message: vi.fn(),
      step: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  };
});

describe('remove command', { timeout: 30000 }, () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create .agents/skills directory (canonical location)
    skillsDir = join(testDir, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(name: string, description?: string) {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description || `A test skill called ${name}`}
---

# ${name}

This is a test skill.
`
    );
  }

  function createAgentSkillsDir(agentName: string) {
    const agentSkillsDir = join(testDir, agentName, 'skills');
    mkdirSync(agentSkillsDir, { recursive: true });
    return agentSkillsDir;
  }

  function createSymlink(skillName: string, targetDir: string) {
    const skillPath = join(skillsDir, skillName);
    const linkPath = join(targetDir, skillName);
    try {
      // Create relative symlink
      const relativePath = join('..', '..', '.agents', 'skills', skillName);
      const { symlinkSync } = require('fs');
      symlinkSync(relativePath, linkPath);
    } catch {
      // Skip if symlinks aren't supported
    }
  }

  describe('with no skills installed', () => {
    it('should show message when no skills found', () => {
      const result = runCli(['remove', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.stdout).toContain('to remove');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for non-existent skill name', () => {
      const result = runCli(['remove', 'non-existent-skill', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with skills installed', () => {
    beforeEach(() => {
      createTestSkill('skill-one', 'First test skill');
      createTestSkill('skill-two', 'Second test skill');
      createTestSkill('skill-three', 'Third test skill');

      // Create symlinks in agent directories
      const claudeSkillsDir = createAgentSkillsDir('.claude');
      createSymlink('skill-one', claudeSkillsDir);
      createSymlink('skill-two', claudeSkillsDir);

      const cursorSkillsDir = createAgentSkillsDir('.cursor');
      createSymlink('skill-one', cursorSkillsDir);
      createSymlink('skill-three', cursorSkillsDir);
    });

    it('should remove specific skill by name with -y flag', () => {
      const result = runCli(['remove', 'skill-one', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      // Verify skill was removed from canonical location
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);

      // Verify other skills still exist
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove multiple skills by name', () => {
      const result = runCli(['remove', 'skill-one', 'skill-two', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 skill');

      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove all skills with --all flag', () => {
      const result = runCli(['remove', '--all', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('3 skill');

      // All skills removed
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(false);
    });

    it('should show error for non-existent skill name when skills exist', () => {
      const result = runCli(['remove', 'non-existent', '-y'], testDir);

      expect(result.stdout).toContain('No matching skills');
      expect(result.exitCode).toBe(0);
    });

    it('should be case-insensitive when matching skill names', () => {
      const result = runCli(['remove', 'SKILL-ONE', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
    });

    it('should remove only the specified skill and leave others', () => {
      runCli(['remove', 'skill-two', '-y'], testDir);

      // skill-two removed
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);

      // Others still exist
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should list skills to remove before confirmation', () => {
      // Answer 'n' to cancel the confirmation prompt
      const result = runCliWithInput(['remove', 'skill-one', 'skill-two'], 'n', testDir);

      // Should show the skills that will be removed
      expect(result.stdout).toContain('Skills to remove');
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('uninstall');

      // Skills should NOT be removed since we cancelled
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(true);
    });
  });

  describe('target filtering', () => {
    beforeEach(() => {
      createTestSkill('test-skill');
      createAgentSkillsDir('.claude');
      createAgentSkillsDir('.cline');
    });

    it('should show error for invalid target name', () => {
      const result = runCli(['remove', 'test-skill', '--targets', 'invalid-agent', '-y'], testDir);

      expect(result.stdout).toContain('Invalid targets');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.stdout).toContain('Valid targets');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid target names', () => {
      // This should not error on target validation
      const result = runCli(['remove', 'test-skill', '--targets', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid targets');
    });

    it('should accept multiple target names', () => {
      const result = runCli(
        ['remove', 'test-skill', '--targets', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid targets');
    });
  });

  describe('global flag', () => {
    beforeEach(() => {
      createTestSkill('global-skill');
    });

    it('should accept --global flag without error', () => {
      const result = runCli(['remove', 'global-skill', '--global', '-y'], testDir);
      // Command should run without error (skill may not be found in global scope from test dir)
      expect(result.exitCode).toBe(0);
    });
  });

  describe('command aliases', () => {
    beforeEach(() => {
      createTestSkill('alias-test-skill');
    });

    it('should support "rm" alias', () => {
      const result = runCli(['rm', 'alias-test-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });

    it('should support "r" alias', () => {
      const result = runCli(['r', 'alias-test-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle skill names with special characters', () => {
      createTestSkill('skill-with-dashes');
      createTestSkill('skill_with_underscores');

      const result = runCli(['remove', 'skill-with-dashes', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-with-dashes'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill_with_underscores'))).toBe(true);
    });

    it('should handle removing last remaining skill', () => {
      createTestSkill('last-skill');

      const result = runCli(['remove', 'last-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      // Directory should be empty or removed
      const remaining = readdirSync(skillsDir);
      expect(remaining.length).toBe(0);
    });

    it('should handle directory without SKILL.md file', () => {
      // Create a directory without SKILL.md
      const invalidSkillDir = join(skillsDir, 'invalid-skill');
      mkdirSync(invalidSkillDir, { recursive: true });
      writeFileSync(join(invalidSkillDir, 'README.md'), 'Just a readme');

      createTestSkill('valid-skill');

      const result = runCli(['remove', 'valid-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');

      // Invalid directory should still be removed
      expect(existsSync(join(skillsDir, 'invalid-skill'))).toBe(true);
    });
  });

  describe('help and info', () => {
    it('should show help with --help', () => {
      const result = runCli(['remove', '--help'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('remove');
      expect(result.stdout).toContain('--global');
      expect(result.stdout).toContain('--targets');
      expect(result.stdout).toContain('--yes');
      expect(result.exitCode).toBe(0);
    });

    it('should show help with -h', () => {
      const result = runCli(['remove', '-h'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('option parsing', () => {
    beforeEach(() => {
      createTestSkill('parse-test-skill');
    });

    it('should parse -g as global', () => {
      const result = runCli(['remove', 'parse-test-skill', '-g', '-y'], testDir);
      expect(result.stdout).not.toContain('error');
      expect(result.stdout).not.toContain('unrecognized');
    });

    it('should parse --yes flag', () => {
      const result = runCli(['remove', 'parse-test-skill', '--yes'], testDir);
      expect(result.exitCode).toBe(0);
    });

    it('should parse -a as target', () => {
      const result = runCli(['remove', 'parse-test-skill', '-a', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid targets');
    });

    it('should handle multiple values for --targets', () => {
      const result = runCli(
        ['remove', 'parse-test-skill', '--targets', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid targets');
    });

    it('should show error for invalid --type value', () => {
      const result = runCli(['remove', '--type', 'invalid', '-y'], testDir);
      expect(result.stdout).toContain('Invalid type: invalid');
      expect(result.stdout).toContain('Valid types: skill, rule, prompt, agent');
      expect(result.exitCode).toBe(1);
    });

    it('should show error for invalid value in comma-separated --type', () => {
      const result = runCli(['remove', '--type', 'rule,invalid', '-y'], testDir);
      expect(result.stdout).toContain('Invalid type: invalid');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('parseRemoveOptions', () => {
    it('should parse --type with single value', () => {
      const { options } = parseRemoveOptions(['--type', 'rule']);
      expect(options.type).toEqual(['rule']);
    });

    it('should parse -t short flag', () => {
      const { options } = parseRemoveOptions(['-t', 'skill']);
      expect(options.type).toEqual(['skill']);
    });

    it('should parse comma-separated --type values', () => {
      const { options } = parseRemoveOptions(['--type', 'rule,prompt']);
      expect(options.type).toEqual(['rule', 'prompt']);
    });

    it('should parse comma-separated --type with all four types', () => {
      const { options } = parseRemoveOptions(['-t', 'skill,rule,prompt,agent']);
      expect(options.type).toEqual(['skill', 'rule', 'prompt', 'agent']);
    });

    it('should deduplicate comma-separated --type values', () => {
      const { options } = parseRemoveOptions(['--type', 'rule,rule,prompt']);
      expect(options.type).toEqual(['rule', 'prompt']);
    });

    it('should deduplicate across repeated flags and comma values', () => {
      const { options } = parseRemoveOptions(['--type', 'rule,prompt', '--type', 'rule']);
      expect(options.type).toEqual(['rule', 'prompt']);
    });

    it('should parse multiple --type flags', () => {
      const { options } = parseRemoveOptions(['--type', 'skill', '--type', 'rule']);
      expect(options.type).toEqual(['skill', 'rule']);
    });

    it('should parse --type with other flags', () => {
      const { skills, options } = parseRemoveOptions(['my-skill', '-g', '--type', 'rule', '-y']);
      expect(skills).toEqual(['my-skill']);
      expect(options.global).toBe(true);
      expect(options.yes).toBe(true);
      expect(options.type).toEqual(['rule']);
    });

    it('should lowercase --type values', () => {
      const { options } = parseRemoveOptions(['--type', 'Rule,PROMPT']);
      expect(options.type).toEqual(['rule', 'prompt']);
    });

    it('should not consume positional args as type values', () => {
      const { skills, options } = parseRemoveOptions(['--type', 'rule', 'my-skill']);
      expect(options.type).toEqual(['rule']);
      expect(skills).toEqual(['my-skill']);
    });

    it('should handle --type with no following value', () => {
      const { options } = parseRemoveOptions(['--type']);
      expect(options.type).toEqual([]);
    });

    it('should handle -t with no following value', () => {
      const { options } = parseRemoveOptions(['-t']);
      expect(options.type).toEqual([]);
    });

    it('should handle -t followed by another flag (no value consumed)', () => {
      const { options } = parseRemoveOptions(['-t', '-g']);
      expect(options.type).toEqual([]);
      expect(options.global).toBe(true);
    });

    it('should filter empty segments from comma-separated --type', () => {
      const { options } = parseRemoveOptions(['--type', 'rule,,prompt']);
      expect(options.type).toEqual(['rule', 'prompt']);
    });

    it('should combine --all with --type', () => {
      const { options } = parseRemoveOptions(['--all', '--type', 'rule']);
      expect(options.all).toBe(true);
      expect(options.type).toEqual(['rule']);
    });

    it('should combine --all with positional skill name', () => {
      const { skills, options } = parseRemoveOptions(['--all', 'my-skill']);
      expect(options.all).toBe(true);
      expect(skills).toEqual(['my-skill']);
    });

    it('should throw CommandError for invalid --type value', () => {
      expect(() => parseRemoveOptions(['--type', 'invalid'])).toThrow(CommandError);

      try {
        parseRemoveOptions(['--type', 'invalid']);
      } catch (error) {
        expect(error).toBeInstanceOf(CommandError);
        expect((error as CommandError).exitCode).toBe(1);
      }
    });

    it('should throw CommandError for invalid value in comma-separated --type', () => {
      expect(() => parseRemoveOptions(['--type', 'rule,bogus'])).toThrow(CommandError);

      try {
        parseRemoveOptions(['--type', 'rule,bogus']);
      } catch (error) {
        expect(error).toBeInstanceOf(CommandError);
        expect((error as CommandError).exitCode).toBe(1);
      }
    });
  });
});

describe('removeCommand unit tests', () => {
  let testDir: string;
  let skillsDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    testDir = join(tmpdir(), `remove-unit-test-${Date.now()}`);
    skillsDir = join(testDir, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw CommandError with exit code 1 for invalid target', async () => {
    // Create a skill so we get past the "no skills found" early return
    const skillDir = join(skillsDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Test');

    await expect(
      removeCommand(['test-skill'], { targets: ['not-a-real-agent'], yes: true })
    ).rejects.toThrow(CommandError);

    try {
      await removeCommand(['test-skill'], { targets: ['not-a-real-agent'], yes: true });
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).exitCode).toBe(1);
    }
  });

  it('should not throw for valid target with matching skill', async () => {
    // Create a skill in canonical location
    const skillDir = join(skillsDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Test');

    // Should complete without throwing
    await expect(
      removeCommand(['test-skill'], { targets: ['claude-code'], yes: true })
    ).resolves.toBeUndefined();
  });
});
