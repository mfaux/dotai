import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WellKnownSkill } from './providers/index.ts';
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
  };
});

vi.mock('./providers/index.ts', () => ({
  wellKnownProvider: {
    fetchAllSkills: vi.fn(),
    getSourceIdentifier: vi.fn().mockReturnValue('wellknown/example.com'),
  },
}));

vi.mock('./agents.ts', async () => {
  const actual = await vi.importActual('./agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

vi.mock('./skill-installer.ts', async () => {
  const actual = await vi.importActual('./skill-installer.ts');
  return {
    ...actual,
    isSkillInstalled: vi.fn().mockResolvedValue(false),
    getCanonicalPath: vi.fn().mockReturnValue('/canonical/path'),
    installWellKnownSkillForAgent: vi.fn(),
  };
});

vi.mock('./add-agents.ts', () => ({
  multiselect: vi.fn(),
  promptForAgents: vi.fn(),
  selectAgentsInteractive: vi.fn(),
}));

vi.mock('./telemetry.ts', () => ({
  track: vi.fn(),
}));

vi.mock('./skill-lock.ts', () => ({
  addSkillToLock: vi.fn(),
}));

vi.mock('./local-lock.ts', () => ({
  addSkillToLocalLock: vi.fn(),
  computeSkillFolderHash: vi.fn().mockResolvedValue('abc123'),
}));

vi.mock('./source-parser.ts', async () => {
  const actual = await vi.importActual('./source-parser.ts');
  return {
    ...actual,
    isSourcePrivate: vi.fn().mockResolvedValue(false),
  };
});

// --- Imports (after mocks) ---

import * as p from '@clack/prompts';
import { handleWellKnownSkills } from './add-wellknown.ts';
import { wellKnownProvider } from './providers/index.ts';
import { detectInstalledAgents } from './agents.ts';
import { isSkillInstalled, installWellKnownSkillForAgent } from './skill-installer.ts';
import { track } from './telemetry.ts';
import { CommandError } from './command-result.ts';
import { addSkillToLock } from './skill-lock.ts';
import { addSkillToLocalLock, computeSkillFolderHash } from './local-lock.ts';
import { isSourcePrivate } from './source-parser.ts';
import { multiselect } from './add-agents.ts';

// --- Helpers ---

function makeSkill(overrides: Partial<WellKnownSkill> = {}): WellKnownSkill {
  return {
    name: 'Test Skill',
    description: 'A test skill',
    content: '# Test',
    installName: 'test-skill',
    sourceUrl: 'https://example.com/.well-known/skills/test-skill/SKILL.md',
    files: new Map([['SKILL.md', '# Test']]),
    indexEntry: { name: 'test-skill', description: 'A test skill', files: ['SKILL.md'] },
    ...overrides,
  };
}

function makeSpinner() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  } as unknown as ReturnType<typeof p.spinner>;
}

function defaultOptions(overrides: Partial<AddOptions> = {}): AddOptions {
  return {
    yes: true,
    targets: ['opencode'],
    copy: true,
    ...overrides,
  };
}

// --- Tests ---

describe('handleWellKnownSkills', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Default: one skill, successful install
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue([makeSkill()]);
    vi.mocked(installWellKnownSkillForAgent).mockResolvedValue({
      success: true,
      path: '/installed/path',
      canonicalPath: '/canonical/path',
      mode: 'copy' as const,
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // --- No skills found ---

  it('exits with error when no skills found from endpoint', async () => {
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue([]);

    const error = await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    ).catch((e) => e);

    expect(error).toBeInstanceOf(CommandError);
    expect(error.exitCode).toBe(1);
  });

  // --- --skill '*' selects all ---

  it('installs all skills with --skill "*"', async () => {
    const skills = [makeSkill(), makeSkill({ installName: 'second-skill', name: 'Second' })];
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue(skills);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ skill: ['*'] }),
      makeSpinner()
    );

    // Both skills should be installed
    expect(installWellKnownSkillForAgent).toHaveBeenCalledTimes(2);
  });

  // --- --skill filters by name ---

  it('filters skills by name with --skill option', async () => {
    const skills = [makeSkill({ installName: 'alpha' }), makeSkill({ installName: 'beta' })];
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue(skills);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ skill: ['beta'] }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledTimes(1);
    expect(installWellKnownSkillForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ installName: 'beta' }),
      'opencode',
      expect.any(Object)
    );
  });

  // --- --skill with non-matching filter ---

  it('exits with error for non-matching --skill filter', async () => {
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue([makeSkill()]);

    const error = await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ skill: ['nonexistent'] }),
      makeSpinner()
    ).catch((e) => e);

    expect(error).toBeInstanceOf(CommandError);
    expect(error.exitCode).toBe(1);
  });

  // --- Auto-selects single skill ---

  it('auto-selects single skill when only one found', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ skill: undefined }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledTimes(1);
  });

  // --- --targets '*' selects all agents ---

  it('installs to all agents with --targets "*"', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ targets: ['*'] }),
      makeSpinner()
    );

    // Should install to every agent in the agents map
    const callCount = vi.mocked(installWellKnownSkillForAgent).mock.calls.length;
    expect(callCount).toBeGreaterThan(1);
  });

  // --- Invalid agent names ---

  it('exits with error for invalid agent names', async () => {
    const error = await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ targets: ['not-a-real-agent'] }),
      makeSpinner()
    ).catch((e) => e);

    expect(error).toBeInstanceOf(CommandError);
    expect(error.exitCode).toBe(1);
  });

  // --- Agent detection when no --targets provided ---

  it('detects installed agents when --targets not provided', async () => {
    vi.mocked(detectInstalledAgents).mockResolvedValue(['opencode'] as AgentType[]);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ targets: undefined, yes: true }),
      makeSpinner()
    );

    expect(detectInstalledAgents).toHaveBeenCalled();
  });

  // --- Install mode prompt ---

  it('uses copy mode with --copy option', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ copy: true }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ mode: 'copy' })
    );
  });

  it('defaults to symlink mode with --yes and no --copy', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ copy: false }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ mode: 'symlink' })
    );
  });

  // --- Telemetry ---

  it('tracks installation via telemetry for public repos', async () => {
    vi.mocked(isSourcePrivate).mockResolvedValue(false);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'install',
        sourceType: 'well-known',
      })
    );
  });

  it('skips telemetry for private repos', async () => {
    vi.mocked(isSourcePrivate).mockResolvedValue(true);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );

    expect(track).not.toHaveBeenCalled();
  });

  // --- Lock files ---

  it('adds to global lock for global installs', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ global: true }),
      makeSpinner()
    );

    expect(addSkillToLock).toHaveBeenCalledWith(
      'test-skill',
      expect.objectContaining({
        source: 'wellknown/example.com',
        sourceType: 'well-known',
      })
    );
    expect(addSkillToLocalLock).not.toHaveBeenCalled();
  });

  it('adds to local lock for project-scoped installs', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ global: false }),
      makeSpinner()
    );

    expect(addSkillToLocalLock).toHaveBeenCalledWith(
      'test-skill',
      expect.objectContaining({
        source: 'wellknown/example.com',
        sourceType: 'well-known',
      }),
      expect.any(String)
    );
    expect(addSkillToLock).not.toHaveBeenCalled();
  });

  // --- onComplete callback ---

  it('calls onComplete callback after successful install', async () => {
    const onComplete = vi.fn();

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner(),
      onComplete
    );

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ yes: true }), ['opencode']);
  });

  it('does not call onComplete when not provided', async () => {
    // Just verify it doesn't throw
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );
  });

  // --- Overwrite detection ---

  it('checks if skills are already installed per agent', async () => {
    vi.mocked(isSkillInstalled).mockResolvedValue(true);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );

    expect(isSkillInstalled).toHaveBeenCalledWith(
      'test-skill',
      'opencode',
      expect.objectContaining({ global: false })
    );
  });

  // --- Multiple agents ---

  it('installs to multiple specified agents', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ targets: ['opencode', 'claude-code'] }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledTimes(2);
    expect(installWellKnownSkillForAgent).toHaveBeenCalledWith(
      expect.any(Object),
      'opencode',
      expect.any(Object)
    );
    expect(installWellKnownSkillForAgent).toHaveBeenCalledWith(
      expect.any(Object),
      'claude-code',
      expect.any(Object)
    );
  });

  // --- Failed installs ---

  it('reports failed installations', async () => {
    vi.mocked(installWellKnownSkillForAgent).mockResolvedValue({
      success: false,
      path: '/failed/path',
      mode: 'copy' as const,
      error: 'Permission denied',
    });

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );

    expect(p.log.error).toHaveBeenCalled();
  });

  // --- Skill selection prompt (interactive) ---

  it('prompts for skill selection when multiple skills and no --yes', async () => {
    const skills = [makeSkill({ installName: 'alpha' }), makeSkill({ installName: 'beta' })];
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue(skills);
    vi.mocked(multiselect).mockResolvedValue(skills);
    vi.mocked(p.confirm).mockResolvedValue(true);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ yes: false, skill: undefined, copy: true }),
      makeSpinner()
    );

    expect(multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select skills to install',
      })
    );
  });

  // --- Scope prompt ---

  it('prompts for scope when global is undefined and not --yes', async () => {
    // Use a single agent that supports global
    vi.mocked(p.select).mockResolvedValue(false); // project scope
    vi.mocked(p.confirm).mockResolvedValue(true); // confirm install

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ yes: false, global: undefined, copy: true }),
      makeSpinner()
    );

    // p.select is called for scope (and possibly install mode if not --copy)
    expect(p.select).toHaveBeenCalled();
  });

  // --- Install mode prompt ---

  it('prompts for install mode when not --copy and not --yes', async () => {
    vi.mocked(p.select)
      .mockResolvedValueOnce(false) // scope: project
      .mockResolvedValueOnce('symlink'); // install mode
    vi.mocked(p.confirm).mockResolvedValue(true); // confirm install

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ yes: false, copy: false, global: undefined }),
      makeSpinner()
    );

    // Two p.select calls: scope + install mode
    expect(p.select).toHaveBeenCalledTimes(2);
  });

  // --- Yes mode skips confirmation ---

  it('skips confirmation prompt in --yes mode', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ yes: true }),
      makeSpinner()
    );

    expect(p.confirm).not.toHaveBeenCalled();
  });

  it('skips installation and lock updates in --dry-run mode', async () => {
    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ dryRun: true }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).not.toHaveBeenCalled();
    expect(addSkillToLock).not.toHaveBeenCalled();
    expect(addSkillToLocalLock).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();
    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('Dry run complete'));
  });

  // --- Symlink failure warning ---

  it('shows warning when symlink fails and falls back to copy', async () => {
    vi.mocked(installWellKnownSkillForAgent).mockResolvedValue({
      success: true,
      path: '/installed/path',
      canonicalPath: '/canonical/path',
      mode: 'symlink' as const,
      symlinkFailed: true,
    });

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions(),
      makeSpinner()
    );

    expect(p.log.warn).toHaveBeenCalled();
  });

  // --- Case-insensitive skill matching ---

  it('matches skill names case-insensitively', async () => {
    const skills = [makeSkill({ installName: 'My-Skill', name: 'My Skill' })];
    vi.mocked(wellKnownProvider.fetchAllSkills).mockResolvedValue(skills);

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ skill: ['my-skill'] }),
      makeSpinner()
    );

    expect(installWellKnownSkillForAgent).toHaveBeenCalledTimes(1);
  });

  // --- Lock file errors don't fail installation ---

  it('does not fail when global lock file update throws', async () => {
    vi.mocked(addSkillToLock).mockRejectedValue(new Error('lock error'));

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ global: true }),
      makeSpinner()
    );

    // Should complete without throwing
    expect(p.outro).toHaveBeenCalled();
  });

  it('does not fail when local lock file update throws', async () => {
    vi.mocked(addSkillToLocalLock).mockRejectedValue(new Error('lock error'));

    await handleWellKnownSkills(
      'https://example.com',
      'https://example.com',
      defaultOptions({ global: false }),
      makeSpinner()
    );

    // Should complete without throwing
    expect(p.outro).toHaveBeenCalled();
  });
});
