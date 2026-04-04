import { describe, it, expect, vi, beforeEach } from 'vitest';
import { multiselect, promptForAgents, selectAgentsInteractive } from './add-agents.js';
import * as skillLock from './lib/lock/skill-lock.js';
import * as searchMultiselectModule from './prompts/search-multiselect.js';
import * as clack from '@clack/prompts';
import * as agentsModule from './lib/agents/agents.js';

// Mock dependencies
vi.mock('./lib/lock/skill-lock.js');
vi.mock('./prompts/search-multiselect.js');
vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual('@clack/prompts');
  return {
    ...actual,
    multiselect: vi.fn(),
  };
});

describe('multiselect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should append "(space to toggle)" hint to the message', async () => {
    vi.mocked(clack.multiselect).mockResolvedValue(['a']);

    await multiselect({
      message: 'Select items',
      options: [{ value: 'a', label: 'Item A' }],
    });

    expect(clack.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Select items'),
      })
    );
    // Verify the hint is appended (contains dim formatting around "space to toggle")
    const call = vi.mocked(clack.multiselect).mock.calls[0]![0];
    expect(call.message).toContain('space to toggle');
  });

  it('should pass through options, initialValues, and required', async () => {
    vi.mocked(clack.multiselect).mockResolvedValue(['a']);

    const options = [
      { value: 'a', label: 'Item A', hint: 'hint' },
      { value: 'b', label: 'Item B' },
    ];

    await multiselect({
      message: 'Pick',
      options,
      initialValues: ['a'],
      required: true,
    });

    expect(clack.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: ['a'],
        required: true,
      })
    );
  });

  it('should return selected values', async () => {
    vi.mocked(clack.multiselect).mockResolvedValue(['a', 'b']);

    const result = await multiselect({
      message: 'Pick',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });

    expect(result).toEqual(['a', 'b']);
  });

  it('should return cancel symbol when cancelled', async () => {
    const cancelSym = Symbol('cancel');
    vi.mocked(clack.multiselect).mockResolvedValue(cancelSym as any);

    const result = await multiselect({
      message: 'Pick',
      options: [{ value: 'a', label: 'A' }],
    });

    expect(typeof result).toBe('symbol');
  });
});

describe('promptForAgents', () => {
  const choices: any[] = [
    { value: 'opencode', label: 'OpenCode' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'claude-code', label: 'Claude Code' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use default agents (claude-code, opencode, codex) when no history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode'],
      })
    );
  });

  it('should use last selected agents when history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['cursor'],
      })
    );
  });

  it('should filter out invalid agents from history', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor', 'invalid-agent']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['cursor'],
      })
    );
  });

  it('should use default agents if all history agents are invalid', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['invalid-agent']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode'],
      })
    );
  });

  it('should save selected agents if not cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    expect(skillLock.saveSelectedAgents).toHaveBeenCalledWith(['opencode']);
  });

  it('should not save agents if cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(
      searchMultiselectModule.cancelSymbol
    );

    await promptForAgents('Select agents', choices);

    expect(skillLock.saveSelectedAgents).not.toHaveBeenCalled();
  });

  it('should pass message and required to searchMultiselect', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Pick your agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pick your agents',
        required: true,
      })
    );
  });

  it('should gracefully handle errors from getLastSelectedAgents', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockRejectedValue(new Error('read error'));
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    // Should not throw
    const result = await promptForAgents('Select agents', choices);
    expect(result).toEqual(['opencode']);

    // Should fall back to defaults
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode'],
      })
    );
  });

  it('should gracefully handle errors from saveSelectedAgents', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);
    vi.mocked(skillLock.saveSelectedAgents).mockRejectedValue(new Error('write error'));

    // Should not throw
    const result = await promptForAgents('Select agents', choices);
    expect(result).toEqual(['opencode']);
  });
});

describe('selectAgentsInteractive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show universal agents as locked section', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: false });

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedSection: expect.objectContaining({
          title: 'Universal (.agents/skills)',
          items: expect.arrayContaining([expect.objectContaining({ label: expect.any(String) })]),
        }),
      })
    );
  });

  it('should show non-universal agents as selectable items', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: false });

    const call = vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
    // items should contain non-universal agents
    expect(call.items.length).toBeGreaterThan(0);
    // Each item should have a hint (skillsDir)
    for (const item of call.items) {
      expect(item).toHaveProperty('hint');
    }
  });

  it('should filter agents by globalSkillsDir when global is true', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: true });

    const call = vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
    // All selectable agents should have globalSkillsDir
    for (const item of call.items) {
      const agentConfig = agentsModule.agents[item.value as keyof typeof agentsModule.agents];
      expect(agentConfig.globalSkillsDir).toBeTruthy();
    }
  });

  it('should use globalSkillsDir as hint when global is true', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: true });

    const call = vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
    for (const item of call.items) {
      const agentConfig = agentsModule.agents[item.value as keyof typeof agentsModule.agents];
      expect(item.hint).toBe(agentConfig.globalSkillsDir);
    }
  });

  it('should save selection when not cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: false });

    expect(skillLock.saveSelectedAgents).toHaveBeenCalledWith(['cursor']);
  });

  it('should not save selection when cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(
      searchMultiselectModule.cancelSymbol
    );

    await selectAgentsInteractive({ global: false });

    expect(skillLock.saveSelectedAgents).not.toHaveBeenCalled();
  });

  it('should filter initial selection to non-universal agents only', async () => {
    const nonUniversal = agentsModule.getNonUniversalAgents();
    const universal = agentsModule.getUniversalAgents();
    // Use a mix of universal and non-universal
    const mixed = [...universal.slice(0, 1), ...nonUniversal.slice(0, 1)];
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(mixed);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: false });

    const call = vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
    // initialSelected should only contain the non-universal agent
    if (call.initialSelected && call.initialSelected.length > 0) {
      for (const agent of call.initialSelected) {
        expect(universal).not.toContain(agent);
      }
    }
  });
});
