import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { shouldInstallInternalSkills } from './skill-discovery.ts';
import { parseAddOptions } from './add.ts';

describe('add command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-add-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show error when no source provided', () => {
    const result = runCli(['add'], testDir);
    expect(result.stdout).toContain('ERROR');
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('should show error for non-existent local path', () => {
    const result = runCli(['add', './non-existent-path', '-y'], testDir);
    expect(result.stdout).toContain('Local path does not exist');
    expect(result.exitCode).toBe(1);
  });

  it('should discover skills from local path with -y flag', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is a test skill.
`
    );

    const result = runCli(['add', testDir, '-y', '-g', '--targets', 'claude-code'], testDir);
    expect(result.stdout).toContain('test-skill');
    expect(result.exitCode).toBe(0);
  });

  it('should show no skills found for empty directory', () => {
    const result = runCli(['add', testDir, '-y'], testDir);
    expect(result.stdout).toContain('No skills found');
    expect(result.stdout).toContain('No valid skills found');
    expect(result.exitCode).toBe(1);
  });

  it('should install skill from local path with -y flag', () => {
    // Create a test skill
    const skillDir = join(testDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    // Create a target directory to install to
    const targetDir = join(testDir, 'project');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(['add', testDir, '-y', '-g', '--targets', 'claude-code'], targetDir);
    expect(result.stdout).toContain('my-skill');
    expect(result.stdout).toContain('Done!');
    expect(result.exitCode).toBe(0);
  });

  it('should not install skill from local path with --dry-run', () => {
    const skillDir = join(testDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    const targetDir = join(testDir, 'project');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(
      ['add', testDir, '-y', '--dry-run', '--targets', 'claude-code'],
      targetDir
    );

    expect(result.stdout).toContain('Dry run');
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(targetDir, '.claude'))).toBe(false);
    expect(existsSync(join(targetDir, '.agents'))).toBe(false);
    expect(existsSync(join(targetDir, 'skills-lock.json'))).toBe(false);
  });

  it('should filter skills by name with --skill flag', () => {
    // Create multiple test skills
    const skill1Dir = join(testDir, 'skills', 'skill-one');
    const skill2Dir = join(testDir, 'skills', 'skill-two');
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

    const result = runCli(
      ['add', testDir, '--skill', 'skill-one', '-y', '-g', '--targets', 'claude-code'],
      testDir
    );
    expect(result.stdout).toContain('skill-one');
  });

  it('should show error for invalid agent name', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: Test
---
# Test
`
    );

    const result = runCli(['add', testDir, '-y', '--targets', 'invalid-agent'], testDir);
    expect(result.stdout).toContain('Invalid targets');
    expect(result.exitCode).toBe(1);
  });

  it('should support add command alias (a)', () => {
    // Test that 'a' alias works (just check it shows missing source error)
    const resultA = runCli(['a'], testDir);
    expect(resultA.stdout).toContain('Missing required argument: source');
  });

  it('should route i/install with no args to add (shows missing source error)', () => {
    // After routing change, i and install always route to add
    const resultI = runCli(['i'], testDir);
    const resultInstall = runCli(['install'], testDir);

    // Should show add behavior (missing source error)
    expect(resultI.stdout).toContain('Missing required argument: source');
    expect(resultI.exitCode).toBe(1);
    expect(resultInstall.stdout).toContain('Missing required argument: source');
    expect(resultInstall.exitCode).toBe(1);
  });

  it('should route i/install with args to runAdd', () => {
    // i and install with args should still route to add
    const resultI = runCli(['i', './non-existent-path'], testDir);
    const resultInstall = runCli(['install', './non-existent-path'], testDir);

    // Should attempt to add, not restore
    expect(resultI.stdout).not.toContain('No project skills found in skills-lock.json');
    expect(resultInstall.stdout).not.toContain('No project skills found in skills-lock.json');
    expect(resultI.stdout).toContain('Local path does not exist');
    expect(resultInstall.stdout).toContain('Local path does not exist');
  });

  it('should restore from lock file with experimental_install', () => {
    const result = runCli(['experimental_install'], testDir);
    expect(result.stdout).toContain('No project skills found in skills-lock.json');
  });

  describe('internal skills', () => {
    it('should skip internal skills by default', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      // --type skill -y will discover and install all skills; internal should be excluded
      const result = runCli(
        ['add', testDir, '--type', 'skill', '-y', '--targets', 'claude-code'],
        testDir
      );
      expect(result.stdout).not.toContain('internal-skill');
    });

    it('should show internal skills when INSTALL_INTERNAL_SKILLS=1', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(
        ['add', testDir, '--skill', 'internal-skill', '-y', '-g', '--targets', 'claude-code'],
        testDir,
        { INSTALL_INTERNAL_SKILLS: '1' }
      );
      expect(result.stdout).toContain('internal-skill');
    });

    it('should show internal skills when INSTALL_INTERNAL_SKILLS=true', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(
        ['add', testDir, '--skill', 'internal-skill', '-y', '-g', '--targets', 'claude-code'],
        testDir,
        { INSTALL_INTERNAL_SKILLS: 'true' }
      );
      expect(result.stdout).toContain('internal-skill');
    });

    it('should show non-internal skills alongside internal when env var is set', () => {
      // Create both internal and non-internal skills
      const internalDir = join(testDir, 'skills', 'internal-skill');
      const publicDir = join(testDir, 'skills', 'public-skill');
      mkdirSync(internalDir, { recursive: true });
      mkdirSync(publicDir, { recursive: true });

      writeFileSync(
        join(internalDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---
# Internal Skill
`
      );

      writeFileSync(
        join(publicDir, 'SKILL.md'),
        `---
name: public-skill
description: A public skill
---
# Public Skill
`
      );

      // Without env var - only public skill visible
      const resultWithout = runCli(
        ['add', testDir, '--type', 'skill', '-y', '--targets', 'claude-code'],
        testDir
      );
      expect(resultWithout.stdout).toContain('public-skill');
      expect(resultWithout.stdout).not.toContain('internal-skill');

      // With env var - both visible
      const resultWith = runCli(
        ['add', testDir, '--type', 'skill', '-y', '--targets', 'claude-code'],
        testDir,
        { INSTALL_INTERNAL_SKILLS: '1' }
      );
      expect(resultWith.stdout).toContain('public-skill');
      expect(resultWith.stdout).toContain('internal-skill');
    });

    it('should not treat metadata.internal: false as internal', () => {
      const skillDir = join(testDir, 'not-internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: not-internal-skill
description: Explicitly not internal
metadata:
  internal: false
---
# Not Internal
`
      );

      const result = runCli(
        ['add', testDir, '--type', 'skill', '-y', '--targets', 'claude-code'],
        testDir
      );
      expect(result.stdout).toContain('not-internal-skill');
    });
  });
});

describe('shouldInstallInternalSkills', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return false when INSTALL_INTERNAL_SKILLS is not set', () => {
    delete process.env.INSTALL_INTERNAL_SKILLS;
    expect(shouldInstallInternalSkills()).toBe(false);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=1', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '1';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=true', () => {
    process.env.INSTALL_INTERNAL_SKILLS = 'true';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '0';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'false';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'yes';
    expect(shouldInstallInternalSkills()).toBe(false);
  });
});

describe('parseAddOptions', () => {
  it('should parse --all flag', () => {
    const result = parseAddOptions(['source', '--all']);
    expect(result.source).toEqual(['source']);
    expect(result.options.all).toBe(true);
  });

  it('should parse --skill with wildcard', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse --targets with wildcard', () => {
    const result = parseAddOptions(['source', '--targets', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.targets).toEqual(['*']);
  });

  it('should parse --skill wildcard with specific targets', () => {
    const result = parseAddOptions(['source', '--skill', '*', '--targets', 'claude-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.targets).toEqual(['claude-code']);
  });

  it('should parse --targets wildcard with specific skills', () => {
    const result = parseAddOptions(['source', '--targets', '*', '--skill', 'my-skill']);
    expect(result.source).toEqual(['source']);
    expect(result.options.targets).toEqual(['*']);
    expect(result.options.skill).toEqual(['my-skill']);
  });

  it('should parse combined flags with wildcards', () => {
    const result = parseAddOptions(['source', '-g', '--skill', '*', '-y']);
    expect(result.source).toEqual(['source']);
    expect(result.options.global).toBe(true);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.yes).toBe(true);
  });

  it('should parse --full-depth flag', () => {
    const result = parseAddOptions(['source', '--full-depth']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
  });

  it('should parse --full-depth with other flags', () => {
    const result = parseAddOptions(['source', '--full-depth', '--type', 'skill', '-g']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
    expect(result.options.type).toEqual(['skill']);
    expect(result.options.global).toBe(true);
  });

  it('should parse --prompt flag', () => {
    const result = parseAddOptions(['source', '--prompt', 'review-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.prompt).toEqual(['review-code']);
  });

  it('should parse -p short flag for prompt', () => {
    const result = parseAddOptions(['source', '-p', 'review-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.prompt).toEqual(['review-code']);
  });

  it('should parse multiple --prompt values', () => {
    const result = parseAddOptions(['source', '--prompt', 'review-code', 'fix-bug']);
    expect(result.source).toEqual(['source']);
    expect(result.options.prompt).toEqual(['review-code', 'fix-bug']);
  });

  it('should parse --prompt with --rule combination', () => {
    const result = parseAddOptions(['source', '--rule', 'code-style', '--prompt', 'review-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.rule).toEqual(['code-style']);
    expect(result.options.prompt).toEqual(['review-code']);
  });

  it('should parse --prompt with --skill combination', () => {
    const result = parseAddOptions(['source', '--skill', 'my-skill', '-p', 'review-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['my-skill']);
    expect(result.options.prompt).toEqual(['review-code']);
  });

  it('should parse --custom-agent flag', () => {
    const result = parseAddOptions(['source', '--custom-agent', 'architect']);
    expect(result.source).toEqual(['source']);
    expect(result.options.customAgent).toEqual(['architect']);
  });

  it('should parse multiple --custom-agent values', () => {
    const result = parseAddOptions(['source', '--custom-agent', 'architect', 'reviewer']);
    expect(result.source).toEqual(['source']);
    expect(result.options.customAgent).toEqual(['architect', 'reviewer']);
  });

  it('should parse --custom-agent with --rule combination', () => {
    const result = parseAddOptions([
      'source',
      '--rule',
      'code-style',
      '--custom-agent',
      'architect',
    ]);
    expect(result.source).toEqual(['source']);
    expect(result.options.rule).toEqual(['code-style']);
    expect(result.options.customAgent).toEqual(['architect']);
  });

  it('should parse --custom-agent with --prompt combination', () => {
    const result = parseAddOptions([
      'source',
      '--prompt',
      'review-code',
      '--custom-agent',
      'architect',
    ]);
    expect(result.source).toEqual(['source']);
    expect(result.options.prompt).toEqual(['review-code']);
    expect(result.options.customAgent).toEqual(['architect']);
  });

  it('should parse --custom-agent with --skill combination', () => {
    const result = parseAddOptions([
      'source',
      '--skill',
      'my-skill',
      '--custom-agent',
      'architect',
    ]);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['my-skill']);
    expect(result.options.customAgent).toEqual(['architect']);
  });

  it('should parse --custom-agent with --targets combination', () => {
    const result = parseAddOptions([
      'source',
      '--custom-agent',
      'architect',
      '--targets',
      'copilot,claude',
    ]);
    expect(result.source).toEqual(['source']);
    expect(result.options.customAgent).toEqual(['architect']);
    expect(result.options.targets).toEqual(['copilot', 'claude']);
  });

  it('should parse --type flag with single type', () => {
    const result = parseAddOptions(['source', '--type', 'rule']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule']);
  });

  it('should parse -t short flag for type', () => {
    const result = parseAddOptions(['source', '-t', 'prompt']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['prompt']);
  });

  it('should parse --type with comma-separated values', () => {
    const result = parseAddOptions(['source', '--type', 'rule,prompt']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule', 'prompt']);
  });

  it('should parse --type with multiple space-separated values', () => {
    const result = parseAddOptions(['source', '--type', 'rule', 'prompt', 'agent']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule', 'prompt', 'agent']);
  });

  it('should parse --type with all four types', () => {
    const result = parseAddOptions(['source', '--type', 'skill,rule,prompt,agent']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['skill', 'rule', 'prompt', 'agent']);
  });

  it('should deduplicate --type values', () => {
    const result = parseAddOptions(['source', '--type', 'rule,rule,prompt']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule', 'prompt']);
  });

  it('should normalize --type values to lowercase', () => {
    const result = parseAddOptions(['source', '--type', 'Rule,PROMPT']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule', 'prompt']);
  });

  it('should parse --type with other flags', () => {
    const result = parseAddOptions([
      'source',
      '--type',
      'rule',
      '--targets',
      'copilot,claude',
      '--force',
    ]);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule']);
    expect(result.options.targets).toEqual(['copilot', 'claude']);
    expect(result.options.force).toBe(true);
  });

  it('should parse --type with explicit --rule names (type sets flow, names filter)', () => {
    const result = parseAddOptions(['source', '--type', 'rule', '--rule', 'code-style']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule']);
    expect(result.options.rule).toEqual(['code-style']);
  });

  it('should handle --type with no following value', () => {
    const result = parseAddOptions(['source', '--type']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual([]);
  });

  it('should handle -t with no following value', () => {
    const result = parseAddOptions(['source', '-t']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual([]);
  });

  it('should filter empty segments from comma-separated --type', () => {
    const result = parseAddOptions(['source', '--type', ',,,']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual([]);
  });

  it('should filter empty segments between valid values', () => {
    const result = parseAddOptions(['source', '--type', 'rule,,prompt']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual(['rule', 'prompt']);
  });

  it('should parse --copy flag', () => {
    const result = parseAddOptions(['source', '--copy']);
    expect(result.source).toEqual(['source']);
    expect(result.options.copy).toBe(true);
  });

  it('should parse multiple sources', () => {
    const result = parseAddOptions(['source1', 'source2', '-y']);
    expect(result.source).toEqual(['source1', 'source2']);
    expect(result.options.yes).toBe(true);
  });

  it('should return empty source and options for empty args', () => {
    const result = parseAddOptions([]);
    expect(result.source).toEqual([]);
    expect(result.options).toEqual({});
  });

  it('should ignore unknown flags starting with -', () => {
    const result = parseAddOptions(['source', '--unknown-flag']);
    expect(result.source).toEqual(['source']);
    // Unknown flags are silently ignored (not added to source)
    expect(result.options).toEqual({});
  });

  it('should handle --type followed by a flag (no value consumed)', () => {
    const result = parseAddOptions(['source', '--type', '--force']);
    expect(result.source).toEqual(['source']);
    expect(result.options.type).toEqual([]);
    expect(result.options.force).toBe(true);
  });
});

describe('find-skills prompt with -y flag', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-yes-flag-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip find-skills prompt when -y flag is passed', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: yes-flag-test-skill
description: A test skill for -y flag testing
---

# Yes Flag Test Skill

This is a test skill for -y flag mode testing.
`
    );

    // Run with -y flag - should complete without hanging
    const result = runCli(['add', testDir, '-g', '-y', '--skill', 'yes-flag-test-skill'], testDir);

    // Should not contain the find-skills prompt
    expect(result.stdout).not.toContain('Install the find-skills skill');
    expect(result.stdout).not.toContain("One-time prompt - you won't be asked again");
    // Should complete successfully
    expect(result.exitCode).toBe(0);
  });
});
