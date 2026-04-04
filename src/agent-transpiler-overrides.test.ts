import { describe, it, expect } from 'vitest';
import {
  transpileAgent,
  copilotAgentTranspiler,
  claudeCodeAgentTranspiler,
} from './agent-transpilers.ts';
import { mergeOverrides } from './lib/parsers/index.ts';
import type { CanonicalAgent, DiscoveredItem } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides?: Partial<CanonicalAgent>): CanonicalAgent {
  return {
    name: 'architect',
    description: 'Senior architect for system design and code review',
    model: 'claude-sonnet-4',
    tools: ['Read', 'Grep'],
    body: 'You are a senior software architect...',
    raw: '---\nname: architect\n---\n\nYou are a senior software architect...',
    ...overrides,
  };
}

function makeDiscoveredItem(
  overrideYaml: string,
  overrides: Partial<DiscoveredItem> = {}
): DiscoveredItem {
  return {
    type: 'agent',
    format: 'canonical',
    name: 'architect',
    description: 'Senior architect for system design and code review',
    sourcePath: '/repo/agents/architect/AGENT.md',
    rawContent: [
      '---',
      'name: architect',
      'description: Senior architect for system design and code review',
      'model: claude-sonnet-4',
      'tools:',
      '  - Read',
      '  - Grep',
      overrideYaml,
      '---',
      '',
      'You are a senior software architect...',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeOverrides integration with agent transpilers
// ---------------------------------------------------------------------------

describe('agent transpiler override merging', () => {
  it('claude-code uses overridden max-turns', () => {
    const agent = makeAgent({
      overrides: {
        'claude-code': { maxTurns: 5 },
      },
    });
    const merged = mergeOverrides(agent, 'claude-code') as CanonicalAgent;
    const output = claudeCodeAgentTranspiler.transform(merged, 'claude-code');

    expect(merged.maxTurns).toBe(5);
    expect(output.content).toContain('max-turns: 5');
  });

  it('copilot omits max-turns (even when base agent has it via claude-code override)', () => {
    const agent = makeAgent({
      overrides: {
        'claude-code': { maxTurns: 5 },
      },
    });
    const merged = mergeOverrides(agent, 'github-copilot') as CanonicalAgent;
    const output = copilotAgentTranspiler.transform(merged, 'github-copilot');

    expect(merged.maxTurns).toBeUndefined();
    expect(output.content).not.toContain('max-turns');
  });

  it('copilot uses overridden model', () => {
    const agent = makeAgent({
      overrides: {
        'github-copilot': { model: 'gpt-4o' },
      },
    });
    const merged = mergeOverrides(agent, 'github-copilot') as CanonicalAgent;
    const output = copilotAgentTranspiler.transform(merged, 'github-copilot');

    expect(merged.model).toBe('gpt-4o');
    expect(output.content).toContain('model: "gpt-4o"');
  });

  it('claude-code uses base model when copilot has override', () => {
    const agent = makeAgent({
      overrides: {
        'github-copilot': { model: 'gpt-4o' },
      },
    });
    const merged = mergeOverrides(agent, 'claude-code') as CanonicalAgent;

    expect(merged.model).toBe('claude-sonnet-4');
  });

  it('claude-code background override appears in output', () => {
    const agent = makeAgent({
      overrides: {
        'claude-code': { background: true },
      },
    });
    const merged = mergeOverrides(agent, 'claude-code') as CanonicalAgent;
    const output = claudeCodeAgentTranspiler.transform(merged, 'claude-code');

    expect(merged.background).toBe(true);
    expect(output.content).toContain('background: true');
  });

  it('claude-code disallowed-tools override appears in output', () => {
    const agent = makeAgent({
      overrides: {
        'claude-code': { disallowedTools: ['Edit', 'Write'] },
      },
    });
    const merged = mergeOverrides(agent, 'claude-code') as CanonicalAgent;
    const output = claudeCodeAgentTranspiler.transform(merged, 'claude-code');

    expect(merged.disallowedTools).toEqual(['Edit', 'Write']);
    expect(output.content).toContain('disallowed-tools:');
    expect(output.content).toContain('  - Edit');
    expect(output.content).toContain('  - Write');
  });

  it('description override is used in transpiled output', () => {
    const agent = makeAgent({
      overrides: {
        'github-copilot': { description: 'Copilot-specific architect' },
      },
    });
    const merged = mergeOverrides(agent, 'github-copilot') as CanonicalAgent;
    const output = copilotAgentTranspiler.transform(merged, 'github-copilot');

    expect(output.content).toContain('description: "Copilot-specific architect"');
  });

  it('agent with no overrides produces identical output', () => {
    const agent = makeAgent();
    const merged = mergeOverrides(agent, 'github-copilot') as CanonicalAgent;
    const output = copilotAgentTranspiler.transform(merged, 'github-copilot');
    const directOutput = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).toBe(directOutput.content);
  });
});

// ---------------------------------------------------------------------------
// transpileAgent integration (end-to-end with raw content)
// ---------------------------------------------------------------------------

describe('transpileAgent with overrides in raw content', () => {
  it('claude-code uses overridden max-turns from raw content', () => {
    const item = makeDiscoveredItem('claude-code:\n  max-turns: 5');
    const claudeOutput = transpileAgent(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    expect(claudeOutput!.content).toContain('max-turns: 5');
  });

  it('copilot omits max-turns when claude-code has override', () => {
    const item = makeDiscoveredItem('claude-code:\n  max-turns: 5');
    const copilotOutput = transpileAgent(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).not.toContain('max-turns');
  });

  it('copilot uses overridden model from raw content', () => {
    const item = makeDiscoveredItem('github-copilot:\n  model: gpt-4o');
    const copilotOutput = transpileAgent(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    // gpt-4o should be resolved via model alias for copilot
    expect(copilotOutput!.content).toContain('model: "gpt-4o"');
  });

  it('claude-code uses base model when copilot has model override', () => {
    const item = makeDiscoveredItem('github-copilot:\n  model: gpt-4o');
    const claudeOutput = transpileAgent(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    // Base model claude-sonnet-4 should resolve for claude-code
    expect(claudeOutput!.content).toContain('model: "claude-sonnet-4"');
  });

  it('claude-code background override from raw content', () => {
    const item = makeDiscoveredItem('claude-code:\n  background: true');
    const claudeOutput = transpileAgent(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    expect(claudeOutput!.content).toContain('background: true');
  });

  it('copilot omits background when claude-code has override', () => {
    const item = makeDiscoveredItem('claude-code:\n  background: true');
    const copilotOutput = transpileAgent(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).not.toContain('background');
  });

  it('no overrides produces same output as before', () => {
    const item = makeDiscoveredItem('');
    const copilotOutput = transpileAgent(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).toContain('model: "claude-sonnet-4"');
    expect(copilotOutput!.content).toContain('  - Read');
    expect(copilotOutput!.content).toContain('  - Grep');
  });
});
