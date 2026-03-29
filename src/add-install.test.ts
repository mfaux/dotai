import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AddOptions } from './add-options.ts';
import type { AgentType } from './types.ts';

// --- Mocks ---

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual('@clack/prompts');
  return {
    ...actual,
    select: vi.fn(),
    confirm: vi.fn(),
    log: { info: vi.fn(), message: vi.fn(), step: vi.fn(), error: vi.fn(), warn: vi.fn() },
    note: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: (v: unknown) => typeof v === 'symbol',
  };
});

vi.mock('./agents.ts', async () => {
  const actual = await vi.importActual('./agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

vi.mock('./add-agents.ts', () => ({
  multiselect: vi.fn(),
  promptForAgents: vi.fn(),
  selectAgentsInteractive: vi.fn(),
}));

vi.mock('./skill-installer.ts', async () => {
  const actual = await vi.importActual('./skill-installer.ts');
  return {
    ...actual,
    isSkillInstalled: vi.fn(),
  };
});

// --- Imports (after mocks) ---

import * as p from '@clack/prompts';
import {
  resolveInstallTargets,
  checkOverwrites,
  displayInstallResults,
  type InstallResult,
} from './add-install.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import { promptForAgents, selectAgentsInteractive } from './add-agents.ts';
import { isSkillInstalled } from './skill-installer.ts';
import { CommandError } from './command-result.ts';

// --- Helpers ---

function makeSpinner() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  } as unknown as ReturnType<typeof p.spinner>;
}

const cancelSymbol = Symbol('cancel');

describe('resolveInstallTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── --targets flag ──

  describe('--targets flag', () => {
    it('--targets "*" selects all agents', async () => {
      const options: AddOptions = { targets: ['*'], yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toEqual(Object.keys(agents));
    });

    it('--targets with specific names validates and returns them', async () => {
      const options: AddOptions = { targets: ['claude-code', 'cursor'], yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toEqual(['claude-code', 'cursor']);
    });

    it('--targets with invalid names throws CommandError', async () => {
      const options: AddOptions = { targets: ['not-a-real-agent'], yes: true, copy: true };

      const error = await resolveInstallTargets(options, makeSpinner()).catch((e) => e);

      expect(error).toBeInstanceOf(CommandError);
      expect(error.exitCode).toBe(1);
      expect(vi.mocked(p.log.error)).toHaveBeenCalled();
    });
  });

  // ── No --targets flag (detection flow) ──

  describe('agent detection', () => {
    it('no agents detected + --yes returns all agents', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue([]);

      const options: AddOptions = { yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toEqual(Object.keys(agents));
    });

    it('no agents detected + interactive prompts for selection', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue([]);
      vi.mocked(promptForAgents).mockResolvedValue(['cursor'] as any);

      const options: AddOptions = { copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toEqual(['cursor']);
      expect(promptForAgents).toHaveBeenCalled();
    });

    it('no agents detected + interactive cancel returns null', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue([]);
      vi.mocked(promptForAgents).mockResolvedValue(cancelSymbol);

      const options: AddOptions = { copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).toBeNull();
    });

    it('single agent detected auto-selects + adds universal agents', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(['cursor']);

      const options: AddOptions = { yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      // Should include cursor + universal agents
      expect(result!.targetAgents).toContain('cursor');
      // Universal agent should be added
      expect(result!.targetAgents.length).toBeGreaterThan(1);
    });

    it('multiple detected + --yes auto-selects with universal agents', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(['cursor', 'opencode']);

      const options: AddOptions = { yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toContain('cursor');
      expect(result!.targetAgents).toContain('opencode');
    });

    it('multiple detected + interactive prompts via selectAgentsInteractive', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(['cursor', 'opencode']);
      vi.mocked(selectAgentsInteractive).mockResolvedValue(['cursor', 'opencode'] as any);

      const options: AddOptions = { copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.targetAgents).toEqual(['cursor', 'opencode']);
      expect(selectAgentsInteractive).toHaveBeenCalled();
    });

    it('multiple detected + interactive cancel returns null', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(['cursor', 'opencode']);
      vi.mocked(selectAgentsInteractive).mockResolvedValue(cancelSymbol);

      const options: AddOptions = { copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).toBeNull();
    });
  });

  // ── Scope (--global) ──

  describe('installation scope', () => {
    it('--global sets installGlobally: true', async () => {
      const options: AddOptions = { targets: ['claude-code'], global: true, yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installGlobally).toBe(true);
    });

    it('no --global defaults to false with --yes', async () => {
      const options: AddOptions = { targets: ['claude-code'], yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installGlobally).toBe(false);
    });

    it('no --global + interactive prompts for scope when agents support global', async () => {
      vi.mocked(p.select).mockResolvedValueOnce(true); // scope = global
      vi.mocked(p.select).mockResolvedValueOnce('symlink'); // mode

      const options: AddOptions = { targets: ['claude-code'] };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installGlobally).toBe(true);
      // First p.select call should be for scope
      expect(vi.mocked(p.select).mock.calls[0]![0]).toHaveProperty('message', 'Installation scope');
    });

    it('scope prompt cancel returns null', async () => {
      vi.mocked(p.select).mockResolvedValueOnce(cancelSymbol); // scope cancelled

      const options: AddOptions = { targets: ['claude-code'] };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).toBeNull();
    });
  });

  // ── Install mode (--copy) ──

  describe('install mode', () => {
    it('--copy sets installMode to copy', async () => {
      const options: AddOptions = { targets: ['claude-code'], yes: true, copy: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installMode).toBe('copy');
    });

    it('no --copy + --yes defaults to symlink', async () => {
      const options: AddOptions = { targets: ['claude-code'], yes: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installMode).toBe('symlink');
    });

    it('no --copy + interactive prompts for install mode', async () => {
      vi.mocked(p.select).mockResolvedValueOnce(false); // scope = project
      vi.mocked(p.select).mockResolvedValueOnce('copy'); // mode = copy

      const options: AddOptions = { targets: ['claude-code'] };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      expect(result!.installMode).toBe('copy');
    });

    it('mode prompt cancel returns null', async () => {
      vi.mocked(p.select).mockResolvedValueOnce(false); // scope = project
      vi.mocked(p.select).mockResolvedValueOnce(cancelSymbol); // mode cancelled

      const options: AddOptions = { targets: ['claude-code'] };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).toBeNull();
    });
  });

  // ── --yes flag ──

  describe('--yes flag', () => {
    it('--yes skips all interactive prompts', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue([]);

      const options: AddOptions = { yes: true };
      const result = await resolveInstallTargets(options, makeSpinner());

      expect(result).not.toBeNull();
      // All agents selected
      expect(result!.targetAgents).toEqual(Object.keys(agents));
      // Defaults applied
      expect(result!.installGlobally).toBe(false);
      expect(result!.installMode).toBe('symlink');
      // No interactive prompts
      expect(promptForAgents).not.toHaveBeenCalled();
      expect(selectAgentsInteractive).not.toHaveBeenCalled();
      expect(p.select).not.toHaveBeenCalled();
    });
  });

  // ── Spinner interaction ──

  describe('spinner', () => {
    it('uses spinner for loading agents when detecting', async () => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(['cursor']);

      const spinner = makeSpinner();
      const options: AddOptions = { yes: true, copy: true };
      await resolveInstallTargets(options, spinner);

      expect(spinner.start).toHaveBeenCalledWith('Loading targets...');
      expect(spinner.stop).toHaveBeenCalled();
    });

    it('does not use spinner when --targets flag is provided', async () => {
      const spinner = makeSpinner();
      const options: AddOptions = { targets: ['claude-code'], yes: true, copy: true };
      await resolveInstallTargets(options, spinner);

      expect(spinner.start).not.toHaveBeenCalled();
      expect(detectInstalledAgents).not.toHaveBeenCalled();
    });
  });
});

describe('checkOverwrites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false entries when nothing is installed', async () => {
    vi.mocked(isSkillInstalled).mockResolvedValue(false);

    const skills = [{ name: 'my-skill' }];
    const agentTypes = ['claude-code', 'cursor'] as AgentType[];

    const result = await checkOverwrites(skills, agentTypes, false);

    expect(result.size).toBe(1);
    expect(result.get('my-skill')!.get('claude-code')).toBe(false);
    expect(result.get('my-skill')!.get('cursor')).toBe(false);
  });

  it('returns true for agents where skill is already installed', async () => {
    vi.mocked(isSkillInstalled).mockImplementation(async (name, agent) => {
      return agent === 'cursor';
    });

    const skills = [{ name: 'my-skill' }];
    const agentTypes = ['claude-code', 'cursor'] as AgentType[];

    const result = await checkOverwrites(skills, agentTypes, false);

    expect(result.get('my-skill')!.get('claude-code')).toBe(false);
    expect(result.get('my-skill')!.get('cursor')).toBe(true);
  });

  it('checks all skill × agent combinations', async () => {
    vi.mocked(isSkillInstalled).mockResolvedValue(false);

    const skills = [{ name: 'skill-a' }, { name: 'skill-b' }];
    const agentTypes = ['claude-code', 'cursor', 'opencode'] as AgentType[];

    const result = await checkOverwrites(skills, agentTypes, false);

    // 2 skills × 3 agents = 6 calls
    expect(isSkillInstalled).toHaveBeenCalledTimes(6);
    expect(result.size).toBe(2);
    expect(result.get('skill-a')!.size).toBe(3);
    expect(result.get('skill-b')!.size).toBe(3);
  });

  it('passes installGlobally to isSkillInstalled', async () => {
    vi.mocked(isSkillInstalled).mockResolvedValue(false);

    const skills = [{ name: 'my-skill' }];
    const agentTypes = ['claude-code'] as AgentType[];

    await checkOverwrites(skills, agentTypes, true);

    expect(isSkillInstalled).toHaveBeenCalledWith('my-skill', 'claude-code', { global: true });
  });

  it('returns empty map for empty skills array', async () => {
    const result = await checkOverwrites([], ['claude-code'] as AgentType[], false);

    expect(result.size).toBe(0);
    expect(isSkillInstalled).not.toHaveBeenCalled();
  });

  it('returns empty agent maps for empty agents array', async () => {
    const result = await checkOverwrites([{ name: 'my-skill' }], [], false);

    expect(result.size).toBe(0);
    expect(isSkillInstalled).not.toHaveBeenCalled();
  });
});

describe('displayInstallResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays successful results grouped by skill', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: true,
        path: '/home/user/project/.cursor/skills/my-skill',
        canonicalPath: '/home/user/project/.skills/my-skill',
        mode: 'symlink',
      },
      {
        skill: 'my-skill',
        agent: 'Claude Code',
        success: true,
        path: '/home/user/project/.claude/skills/my-skill',
        canonicalPath: '/home/user/project/.skills/my-skill',
        mode: 'symlink',
      },
    ];

    displayInstallResults(results, ['cursor', 'claude-code'] as AgentType[], '/home/user/project');

    expect(vi.mocked(p.note)).toHaveBeenCalledTimes(1);
    const noteCall = vi.mocked(p.note).mock.calls[0]!;
    // Title should mention 1 skill
    expect(noteCall[1]).toContain('1 skill');
  });

  it('shows copy mode paths', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: true,
        path: '/home/user/project/.cursor/skills/my-skill',
        mode: 'copy',
      },
      {
        skill: 'my-skill',
        agent: 'Claude Code',
        success: true,
        path: '/home/user/project/.claude/skills/my-skill',
        mode: 'copy',
      },
    ];

    displayInstallResults(results, ['cursor', 'claude-code'] as AgentType[], '/home/user/project');

    expect(vi.mocked(p.note)).toHaveBeenCalledTimes(1);
    const noteBody = vi.mocked(p.note).mock.calls[0]![0] as string;
    // Should contain "(copied)" indicator
    expect(noteBody).toContain('(copied)');
    // Should show paths with arrow
    expect(noteBody).toContain('→');
  });

  it('shows symlink mode with canonical path', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: true,
        path: '/home/user/project/.cursor/skills/my-skill',
        canonicalPath: '/home/user/project/.skills/my-skill',
        mode: 'symlink',
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user/project');

    expect(vi.mocked(p.note)).toHaveBeenCalledTimes(1);
    const noteBody = vi.mocked(p.note).mock.calls[0]![0] as string;
    // Should show shortened canonical path
    expect(noteBody).toContain('.skills/my-skill');
  });

  it('shows symlink failure warning', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: true,
        path: '/home/user/project/.cursor/skills/my-skill',
        canonicalPath: '/home/user/project/.skills/my-skill',
        mode: 'symlink',
        symlinkFailed: true,
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user/project');

    expect(vi.mocked(p.log.warn)).toHaveBeenCalled();
    const warnCall = vi.mocked(p.log.warn).mock.calls[0]![0] as string;
    expect(warnCall).toContain('Symlinks failed');
    expect(vi.mocked(p.log.message)).toHaveBeenCalled();
  });

  it('shows failed installations', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: false,
        path: '',
        mode: 'symlink',
        error: 'Permission denied',
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user/project');

    // Should not call p.note (no successful results)
    expect(vi.mocked(p.note)).not.toHaveBeenCalled();
    // Should show error
    expect(vi.mocked(p.log.error)).toHaveBeenCalled();
    expect(vi.mocked(p.log.message)).toHaveBeenCalled();
    const msgCall = vi.mocked(p.log.message).mock.calls[0]![0] as string;
    expect(msgCall).toContain('my-skill');
    expect(msgCall).toContain('Cursor');
    expect(msgCall).toContain('Permission denied');
  });

  it('groups by plugin name when present', () => {
    const results: InstallResult[] = [
      {
        skill: 'skill-a',
        agent: 'Cursor',
        success: true,
        path: '/path/a',
        canonicalPath: '/canonical/a',
        mode: 'symlink',
        pluginName: 'my-plugin',
      },
      {
        skill: 'skill-b',
        agent: 'Cursor',
        success: true,
        path: '/path/b',
        canonicalPath: '/canonical/b',
        mode: 'symlink',
        pluginName: 'my-plugin',
      },
      {
        skill: 'skill-c',
        agent: 'Cursor',
        success: true,
        path: '/path/c',
        canonicalPath: '/canonical/c',
        mode: 'symlink',
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user');

    expect(vi.mocked(p.note)).toHaveBeenCalledTimes(1);
    const noteBody = vi.mocked(p.note).mock.calls[0]![0] as string;
    // Should contain the plugin group title (kebab-to-title)
    expect(noteBody).toContain('My Plugin');
    // Should contain "General" for ungrouped
    expect(noteBody).toContain('General');
    // Title should mention 3 skills
    const noteTitle = vi.mocked(p.note).mock.calls[0]![1] as string;
    expect(noteTitle).toContain('3 skills');
  });

  it('handles empty results', () => {
    displayInstallResults([], ['cursor'] as AgentType[], '/home/user');

    // No note, no error — nothing to display
    expect(vi.mocked(p.note)).not.toHaveBeenCalled();
    expect(vi.mocked(p.log.error)).not.toHaveBeenCalled();
  });

  it('handles mixed success and failure', () => {
    const results: InstallResult[] = [
      {
        skill: 'skill-a',
        agent: 'Cursor',
        success: true,
        path: '/path/a',
        mode: 'copy',
      },
      {
        skill: 'skill-b',
        agent: 'Cursor',
        success: false,
        path: '',
        mode: 'copy',
        error: 'Disk full',
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user');

    // Should show both success note and error
    expect(vi.mocked(p.note)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.log.error)).toHaveBeenCalled();
  });

  it('shows skill name when no canonical path in symlink mode', () => {
    const results: InstallResult[] = [
      {
        skill: 'my-skill',
        agent: 'Cursor',
        success: true,
        path: '/path/to/skill',
        mode: 'symlink',
        // no canonicalPath
      },
    ];

    displayInstallResults(results, ['cursor'] as AgentType[], '/home/user');

    const noteBody = vi.mocked(p.note).mock.calls[0]![0] as string;
    expect(noteBody).toContain('my-skill');
  });
});
