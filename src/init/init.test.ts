import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliOutput, stripLogo } from '../lib/test-utils.ts';

describe('init command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize a skill and create SKILL.md', () => {
    const output = stripLogo(runCliOutput(['init', 'my-test-skill'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Initialized skill: my-test-skill

      Created:
        my-test-skill/SKILL.md

      Next steps:
        1. Edit my-test-skill/SKILL.md to define your skill instructions
        2. Update the name and description in the frontmatter

      Publishing:
        GitHub:  Push to a repo, then npx dotai add <owner>/<repo>
        URL:     Host the file, then npx dotai add https://example.com/my-test-skill/SKILL.md

      Browse existing skills for inspiration at https://skills.sh/

      "
    `);

    const skillPath = join(testDir, 'my-test-skill', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatchInlineSnapshot(`
      "---
      name: my-test-skill
      description: A brief description of what this skill does
      ---

      # my-test-skill

      Instructions for the agent to follow when this skill is activated.

      ## When to use

      Describe when this skill should be used.

      ## Instructions

      1. First step
      2. Second step
      3. Additional steps as needed
      "
    `);
  });

  it('should allow multiple skills in same directory', () => {
    runCliOutput(['init', 'hydration-fix'], testDir);
    runCliOutput(['init', 'waterfall-data-fetching'], testDir);

    expect(existsSync(join(testDir, 'hydration-fix', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(testDir, 'waterfall-data-fetching', 'SKILL.md'))).toBe(true);
  });

  it('should init SKILL.md in cwd when no name provided', () => {
    const output = stripLogo(runCliOutput(['init'], testDir));

    expect(output).toContain('Initialized skill:');
    expect(output).toContain('Created:\n  SKILL.md'); // directly in cwd, not in a subfolder
    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:');
    expect(output).toContain('npx dotai add <owner>/<repo>');
    expect(output).toContain('URL:');
    expect(output).toContain('npx dotai add https://example.com/SKILL.md');
    expect(existsSync(join(testDir, 'SKILL.md'))).toBe(true);
  });

  it('should show publishing hints with skill path', () => {
    const output = stripLogo(runCliOutput(['init', 'my-skill'], testDir));

    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:  Push to a repo, then npx dotai add <owner>/<repo>');
    expect(output).toContain(
      'URL:     Host the file, then npx dotai add https://example.com/my-skill/SKILL.md'
    );
  });

  it('should show error if skill already exists', () => {
    runCliOutput(['init', 'existing-skill'], testDir);
    const output = stripLogo(runCliOutput(['init', 'existing-skill'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Skill already exists at existing-skill/SKILL.md
      "
    `);
  });

  it('should initialize a prompt with init prompt <name>', () => {
    const output = stripLogo(runCliOutput(['init', 'prompt', 'review-code'], testDir));
    expect(output).toContain('Initialized prompt: review-code');
    expect(output).toContain('review-code/PROMPT.md');

    const promptPath = join(testDir, 'review-code', 'PROMPT.md');
    expect(existsSync(promptPath)).toBe(true);

    const content = readFileSync(promptPath, 'utf-8');
    expect(content).toContain('name: review-code');
    expect(content).toContain('description: Describe what this prompt does');
    expect(content).toContain('argument-hint:');
    expect(content).toContain('$ARGUMENTS');
  });

  it('should show error if prompt already exists', () => {
    runCliOutput(['init', 'prompt', 'existing-prompt'], testDir);
    const output = stripLogo(runCliOutput(['init', 'prompt', 'existing-prompt'], testDir));
    expect(output).toContain('Prompt already exists');
  });

  it('should support --prompt flag for init', () => {
    const output = stripLogo(runCliOutput(['init', '--prompt', 'my-prompt'], testDir));
    expect(output).toContain('Initialized prompt: my-prompt');

    const promptPath = join(testDir, 'my-prompt', 'PROMPT.md');
    expect(existsSync(promptPath)).toBe(true);
  });

  it('should initialize an agent with init agent <name>', () => {
    const output = stripLogo(runCliOutput(['init', 'agent', 'architect'], testDir));
    expect(output).toContain('Initialized agent: architect');
    expect(output).toContain('architect/AGENT.md');

    const agentPath = join(testDir, 'architect', 'AGENT.md');
    expect(existsSync(agentPath)).toBe(true);

    const content = readFileSync(agentPath, 'utf-8');
    expect(content).toContain('name: architect');
    expect(content).toContain('description: Describe what this agent does');
    expect(content).toContain('specialized agent');
  });

  it('should show error if agent already exists', () => {
    runCliOutput(['init', 'agent', 'existing-agent'], testDir);
    const output = stripLogo(runCliOutput(['init', 'agent', 'existing-agent'], testDir));
    expect(output).toContain('Agent already exists');
  });

  it('should support --agent flag for init', () => {
    const output = stripLogo(runCliOutput(['init', '--agent', 'my-agent'], testDir));
    expect(output).toContain('Initialized agent: my-agent');

    const agentPath = join(testDir, 'my-agent', 'AGENT.md');
    expect(existsSync(agentPath)).toBe(true);
  });

  it('should initialize an instruction with init instruction <name>', () => {
    const output = stripLogo(runCliOutput(['init', 'instruction', 'my-instructions'], testDir));
    expect(output).toContain('Initialized instruction: my-instructions');
    expect(output).toContain('my-instructions/INSTRUCTIONS.md');

    const instructionPath = join(testDir, 'my-instructions', 'INSTRUCTIONS.md');
    expect(existsSync(instructionPath)).toBe(true);

    const content = readFileSync(instructionPath, 'utf-8');
    expect(content).toContain('name: my-instructions');
    expect(content).toContain('description: Describe what this instruction does');
    expect(content).toContain('Your instruction content here.');
  });

  it('should init INSTRUCTIONS.md in cwd when no name provided for instruction', () => {
    const output = stripLogo(runCliOutput(['init', 'instruction'], testDir));
    expect(output).toContain('Initialized instruction:');
    expect(output).toContain('Created:\n  INSTRUCTIONS.md');
    expect(existsSync(join(testDir, 'INSTRUCTIONS.md'))).toBe(true);
  });

  it('should show error if instruction already exists', () => {
    runCliOutput(['init', 'instruction', 'existing-instruction'], testDir);
    const output = stripLogo(
      runCliOutput(['init', 'instruction', 'existing-instruction'], testDir)
    );
    expect(output).toContain('Instruction already exists');
  });

  it('should support --instruction flag for init', () => {
    const output = stripLogo(runCliOutput(['init', '--instruction', 'my-instruction'], testDir));
    expect(output).toContain('Initialized instruction: my-instruction');

    const instructionPath = join(testDir, 'my-instruction', 'INSTRUCTIONS.md');
    expect(existsSync(instructionPath)).toBe(true);
  });

  it('should reject instruction names with path traversal', () => {
    const escapeName = `escape-instruction-${Date.now()}`;
    const output = stripLogo(runCliOutput(['init', 'instruction', `../${escapeName}`], testDir));
    expect(output).toContain('Invalid name');
    expect(existsSync(join(testDir, `../${escapeName}`, 'INSTRUCTIONS.md'))).toBe(false);
  });

  describe('name validation', () => {
    // Use a unique escape name per test run to avoid collisions with
    // stale files from prior runs (e.g. /tmp/escape/ leftover from
    // before validation was added).
    const escapeName = `escape-${Date.now()}`;

    it('should reject names with path traversal (../)', () => {
      const output = stripLogo(runCliOutput(['init', `../${escapeName}`], testDir));
      expect(output).toContain('Invalid name');
      // Should not create a directory outside testDir
      expect(existsSync(join(testDir, `../${escapeName}`, 'SKILL.md'))).toBe(false);
    });

    it('should reject names with forward slashes', () => {
      const output = stripLogo(runCliOutput(['init', 'foo/bar'], testDir));
      expect(output).toContain('Invalid name');
      expect(existsSync(join(testDir, 'foo', 'SKILL.md'))).toBe(false);
      expect(existsSync(join(testDir, 'foo', 'bar', 'SKILL.md'))).toBe(false);
    });

    it('should reject names with backslashes', () => {
      // Shell escaping: pass a literal backslash
      const result = runCli(['init', 'foo\\\\bar'], testDir);
      const output = stripLogo(result.stdout || result.stderr);
      expect(output).toContain('Invalid name');
    });

    it('should reject prompt names with path traversal', () => {
      const output = stripLogo(runCliOutput(['init', 'prompt', `../${escapeName}`], testDir));
      expect(output).toContain('Invalid name');
      expect(existsSync(join(testDir, `../${escapeName}`, 'PROMPT.md'))).toBe(false);
    });

    it('should reject agent names with path traversal', () => {
      const output = stripLogo(runCliOutput(['init', 'agent', `../${escapeName}`], testDir));
      expect(output).toContain('Invalid name');
      expect(existsSync(join(testDir, `../${escapeName}`, 'AGENT.md'))).toBe(false);
    });

    it('should reject names with uppercase letters', () => {
      const output = stripLogo(runCliOutput(['init', 'MySkill'], testDir));
      expect(output).toContain('Invalid name');
      expect(existsSync(join(testDir, 'MySkill', 'SKILL.md'))).toBe(false);
    });

    it('should reject names that are not kebab-case', () => {
      const output = stripLogo(runCliOutput(['init', 'my_skill'], testDir));
      expect(output).toContain('Invalid name');
      expect(existsSync(join(testDir, 'my_skill', 'SKILL.md'))).toBe(false);
    });
  });
});
