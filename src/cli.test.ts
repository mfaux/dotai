import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCliOutput, stripLogo, hasLogo } from './test-utils.ts';

describe('dotai CLI', () => {
  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: dotai <command> [options]');
      expect(output).toContain('Manage Context:');
      expect(output).toContain('init [name]');
      expect(output).toContain('add <package>');
      expect(output).toContain('check');
      expect(output).toContain('update');
      expect(output).toContain('Add Options:');
      expect(output).toContain('-g, --global');
      expect(output).toContain('-a, --agent');
      expect(output).toContain('-s, --skill');
      expect(output).toContain('-r, --rule');
      expect(output).toContain('--targets');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--force');
      expect(output).toContain('-l, --list');
      expect(output).toContain('-y, --yes');
      expect(output).toContain('--all');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['--help']);
      const hOutput = runCliOutput(['-h']);
      expect(hOutput).toBe(helpOutput);
    });

    it('should describe check command with all four context types', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Check for available updates (skills, rules, prompts, agents)');
    });

    it('should describe init as creating any context template', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Create a new context template (skill, rule, prompt, or agent)');
    });

    it('should include --type in Remove Options', () => {
      const output = runCliOutput(['--help']);
      // Verify --type appears in Remove Options section
      const removeSection = output.split('Remove Options:')[1]?.split(/\n\n/)[0] ?? '';
      expect(removeSection).toContain('-t, --type');
      expect(removeSection).toContain('skill, rule, prompt, agent');
    });

    it('should use generic remove argument name', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('remove [names]');
    });

    it('should list install and i as aliases of add', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('(alias: a, install, i)');
    });

    it('should show restore in the Project section', () => {
      const output = runCliOutput(['--help']);
      const projectSection = output.split('Project:')[1]?.split(/\n\n/)[0] ?? '';
      expect(projectSection).toContain('restore');
      expect(projectSection).toContain(
        'Restore skills, rules, prompts, and agents from lock files'
      );
    });

    it('should show experimental_install as alias of restore', () => {
      const output = runCliOutput(['--help']);
      const projectSection = output.split('Project:')[1]?.split(/\n\n/)[0] ?? '';
      expect(projectSection).toContain('(alias: experimental_install)');
    });

    it('should show restore example in examples section', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('dotai restore');
      expect(output).toContain('restore from lock files');
    });
  });

  describe('remove --help', () => {
    it('should describe removing all context types', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain('Remove installed context (skills, rules, prompts, or agents)');
    });

    it('should document --type option', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain('-t, --type');
      expect(output).toContain('skill, rule, prompt, agent');
    });

    it('should include --type examples', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain('--type rule');
      expect(output).toContain('--type prompt');
    });
  });

  describe('--version', () => {
    it('should display version number', () => {
      const output = runCliOutput(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should match package.json version', () => {
      const output = runCliOutput(['--version']);
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
      );
      expect(output.trim()).toBe(pkg.version);
    });
  });

  describe('no arguments', () => {
    it('should display banner', () => {
      const output = stripLogo(runCliOutput([]));
      expect(output).toContain('Universal context distribution for AI coding agents');
      expect(output).toContain('npx dotai add');
      expect(output).toContain('npx dotai check');
      expect(output).toContain('npx dotai update');
      expect(output).toContain('npx dotai init');
      expect(output).toContain('skills.sh');
    });

    it('should show restore (not install) for lock-file restoration in banner', () => {
      const output = stripLogo(runCliOutput([]));
      expect(output).toContain('npx dotai restore');
    });
  });

  describe('unknown command', () => {
    it('should show error for unknown command', () => {
      const output = runCliOutput(['unknown-command']);
      expect(output).toMatchInlineSnapshot(`
        "Unknown command: unknown-command
        Run dotai --help for usage.
        "
      `);
    });
  });

  describe('logo display', () => {
    it('should not display logo for list command', () => {
      const output = runCliOutput(['list']);
      expect(hasLogo(output)).toBe(false);
    });

    it('should not display logo for check command', () => {
      // Note: check command makes GitHub API calls, so we just verify initial output
      const output = runCliOutput(['check']);
      expect(hasLogo(output)).toBe(false);
    }, 60000);

    it('should not display logo for update command', () => {
      // Note: update command makes GitHub API calls, so we just verify initial output
      const output = runCliOutput(['update']);
      expect(hasLogo(output)).toBe(false);
    }, 60000);
  });
});
