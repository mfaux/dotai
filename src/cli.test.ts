import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCliOutput, stripLogo, hasLogo } from './test-utils.ts';

describe('dotai CLI', () => {
  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: dotai <command> [options]');
      expect(output).toContain('Commands:');
      expect(output).toContain('add <package>');
      expect(output).toContain('remove [names]');
      expect(output).toContain('list, ls');
      expect(output).toContain('find [query]');
      expect(output).toContain('check');
      expect(output).toContain('update');
      expect(output).toContain('restore');
      expect(output).toContain('init [name]');
      expect(output).toContain('dotai <command> --help');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['--help']);
      const hOutput = runCliOutput(['-h']);
      expect(hOutput).toBe(helpOutput);
    });

    it('should show examples', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Examples:');
      expect(output).toContain('dotai add');
      expect(output).toContain('dotai remove');
    });
  });

  describe('add --help', () => {
    it('should display essential add options', () => {
      const output = runCliOutput(['add', '--help']);
      expect(output).toContain('Usage: dotai add <package> [options]');
      expect(output).toContain('-a, --targets');
      expect(output).toContain('-t, --type');
      expect(output).toContain('-g, --global');
      expect(output).toContain('-y, --yes');
      expect(output).toContain('--help-all');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['add', '--help']);
      const hOutput = runCliOutput(['add', '-h']);
      expect(hOutput).toBe(helpOutput);
    });

    it('should display all options with --help-all', () => {
      const output = runCliOutput(['add', '--help-all']);
      expect(output).toContain('Usage: dotai add <package> [options]');
      expect(output).toContain('-s, --skill');
      expect(output).toContain('-p, --prompt');
      expect(output).toContain('-a, --targets');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--force');
      expect(output).toContain('--gitignore');
      expect(output).toContain('-y, --yes');
      expect(output).toContain('--all');
    });
  });

  describe('list --help', () => {
    it('should display list-specific options', () => {
      const output = runCliOutput(['list', '--help']);
      expect(output).toContain('Usage: dotai list [options]');
      expect(output).toContain('-g, --global');
      expect(output).toContain('-a, --targets');
      expect(output).toContain('-t, --type');
    });
  });

  describe('remove --help', () => {
    it('should describe removing all context types', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain(
        'Remove installed context (skills, prompts, agents, or instructions)'
      );
    });

    it('should document --type option', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain('-t, --type');
      expect(output).toContain('skill, prompt, agent, instruction');
    });

    it('should include --type examples', () => {
      const output = runCliOutput(['remove', '--help']);
      expect(output).toContain('--type prompt');
      expect(output).toContain('--type skill,prompt');
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
