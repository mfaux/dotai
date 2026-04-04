import { describe, it, expect } from 'vitest';
import {
  copilotAgentTranspiler,
  claudeCodeAgentTranspiler,
  opencodeAgentTranspiler,
  nativeAgentPassthrough,
  agentTranspilers,
  transpileAgent,
  transpileAgentForAllAgents,
} from './agent-transpilers.ts';
import { TARGET_AGENTS } from '../agents/index.ts';
import type { CanonicalAgent, DiscoveredItem, TargetAgent } from '../../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<CanonicalAgent> = {}): CanonicalAgent {
  return {
    name: 'architect',
    description: 'Senior architect for system design and code review',
    body: 'You are a senior software architect...',
    raw: '---\nname: architect\ndescription: Senior architect for system design and code review\n---\n\nYou are a senior software architect...',
    ...overrides,
  };
}

function makeDiscoveredAgentItem(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
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
      '---',
      '',
      'You are a senior software architect...',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canTranspile
// ---------------------------------------------------------------------------

describe('canTranspile', () => {
  const canonicalAgent = makeDiscoveredAgentItem();
  const nativeAgent = makeDiscoveredAgentItem({ format: 'native:github-copilot' });
  const skillItem = makeDiscoveredAgentItem({ type: 'skill' });
  const ruleItem = makeDiscoveredAgentItem({ type: 'prompt' });
  const promptItem = makeDiscoveredAgentItem({ type: 'prompt' });

  it.each([
    ['copilot', copilotAgentTranspiler],
    ['claude-code', claudeCodeAgentTranspiler],
    ['opencode', opencodeAgentTranspiler],
  ] as const)('%s accepts canonical agents', (_name, transpiler) => {
    expect(transpiler.canTranspile(canonicalAgent)).toBe(true);
  });

  it.each([
    ['copilot', copilotAgentTranspiler],
    ['claude-code', claudeCodeAgentTranspiler],
    ['opencode', opencodeAgentTranspiler],
  ] as const)('%s rejects native agents', (_name, transpiler) => {
    expect(transpiler.canTranspile(nativeAgent)).toBe(false);
  });

  it.each([
    ['copilot', copilotAgentTranspiler],
    ['claude-code', claudeCodeAgentTranspiler],
    ['opencode', opencodeAgentTranspiler],
  ] as const)('%s rejects skill items', (_name, transpiler) => {
    expect(transpiler.canTranspile(skillItem)).toBe(false);
  });

  it.each([
    ['copilot', copilotAgentTranspiler],
    ['claude-code', claudeCodeAgentTranspiler],
    ['opencode', opencodeAgentTranspiler],
  ] as const)('%s rejects rule items', (_name, transpiler) => {
    expect(transpiler.canTranspile(ruleItem)).toBe(false);
  });

  it.each([
    ['copilot', copilotAgentTranspiler],
    ['claude-code', claudeCodeAgentTranspiler],
    ['opencode', opencodeAgentTranspiler],
  ] as const)('%s rejects prompt items', (_name, transpiler) => {
    expect(transpiler.canTranspile(promptItem)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copilot agent transpiler
// ---------------------------------------------------------------------------

describe('Copilot agent transpiler', () => {
  it('produces .agent.md file in .github/agents/', () => {
    const agent = makeAgent();
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.filename).toBe('architect.agent.md');
    expect(output.outputDir).toBe('.github/agents');
    expect(output.mode).toBe('write');
  });

  it('includes name and description in frontmatter', () => {
    const agent = makeAgent();
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).toContain('name: "architect"');
    expect(output.content).toContain(
      'description: "Senior architect for system design and code review"'
    );
  });

  it('includes model in frontmatter when present', () => {
    const agent = makeAgent({ model: 'claude-sonnet-4' });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).toContain('model: "claude-sonnet-4"');
  });

  it('includes tools array in frontmatter when present', () => {
    const agent = makeAgent({ tools: ['Read', 'Grep', 'Write'] });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).toContain('tools:');
    expect(output.content).toContain('  - Read');
    expect(output.content).toContain('  - Grep');
    expect(output.content).toContain('  - Write');
  });

  it('omits model when absent', () => {
    const agent = makeAgent({ model: undefined });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).not.toMatch(/^model:/m);
  });

  it('omits tools when absent', () => {
    const agent = makeAgent({ tools: undefined });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).not.toMatch(/^tools:/m);
  });

  it('omits tools when empty', () => {
    const agent = makeAgent({ tools: [] });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).not.toMatch(/^tools:/m);
  });

  it('does NOT include Claude-only fields (disallowed-tools, max-turns, background)', () => {
    const agent = makeAgent({
      disallowedTools: ['Edit'],
      maxTurns: 25,
      background: true,
    });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).not.toMatch(/disallowed-tools:/m);
    expect(output.content).not.toMatch(/max-turns:/m);
    expect(output.content).not.toMatch(/background:/m);
  });

  it('body passed through unchanged', () => {
    const body =
      'You are a senior software architect.\n\nFocus on:\n1. System design\n2. Code review';
    const agent = makeAgent({ body });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    expect(output.content).toContain(body);
  });

  it('includes all optional fields in correct order', () => {
    const agent = makeAgent({
      model: 'claude-sonnet-4',
      tools: ['Read'],
    });
    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');

    const content = output.content;
    const nameIdx = content.indexOf('name:');
    const descIdx = content.indexOf('description:');
    const modelIdx = content.indexOf('model:');
    const toolsIdx = content.indexOf('tools:');

    expect(nameIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(toolsIdx);
  });
});

// ---------------------------------------------------------------------------
// Claude Code agent transpiler
// ---------------------------------------------------------------------------

describe('Claude Code agent transpiler', () => {
  it('produces .md file in .claude/agents/', () => {
    const agent = makeAgent();
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.filename).toBe('architect.md');
    expect(output.outputDir).toBe('.claude/agents');
    expect(output.mode).toBe('write');
  });

  it('includes name and description in frontmatter', () => {
    const agent = makeAgent();
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('name: "architect"');
    expect(output.content).toContain(
      'description: "Senior architect for system design and code review"'
    );
  });

  it('includes model in frontmatter when present', () => {
    const agent = makeAgent({ model: 'claude-sonnet-4' });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('model: "claude-sonnet-4"');
  });

  it('includes tools array in frontmatter when present', () => {
    const agent = makeAgent({ tools: ['Read', 'Grep'] });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('tools:');
    expect(output.content).toContain('  - Read');
    expect(output.content).toContain('  - Grep');
  });

  it('includes disallowed-tools in frontmatter when present', () => {
    const agent = makeAgent({ disallowedTools: ['Edit', 'Write'] });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('disallowed-tools:');
    expect(output.content).toContain('  - Edit');
    expect(output.content).toContain('  - Write');
  });

  it('includes max-turns in frontmatter when present', () => {
    const agent = makeAgent({ maxTurns: 25 });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('max-turns: 25');
  });

  it('includes background in frontmatter when present', () => {
    const agent = makeAgent({ background: true });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('background: true');
  });

  it('handles background: false', () => {
    const agent = makeAgent({ background: false });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain('background: false');
  });

  it('omits optional fields when absent', () => {
    const agent = makeAgent({
      model: undefined,
      tools: undefined,
      disallowedTools: undefined,
      maxTurns: undefined,
      background: undefined,
    });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).not.toMatch(/^model:/m);
    expect(output.content).not.toMatch(/^tools:/m);
    expect(output.content).not.toMatch(/^disallowed-tools:/m);
    expect(output.content).not.toMatch(/^max-turns:/m);
    expect(output.content).not.toMatch(/^background:/m);
  });

  it('omits tools when empty', () => {
    const agent = makeAgent({ tools: [] });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).not.toMatch(/^tools:/m);
  });

  it('omits disallowed-tools when empty', () => {
    const agent = makeAgent({ disallowedTools: [] });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).not.toMatch(/^disallowed-tools:/m);
  });

  it('body passed through unchanged', () => {
    const body =
      'You are a senior software architect.\n\nFocus on:\n1. System design\n2. Code review';
    const agent = makeAgent({ body });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    expect(output.content).toContain(body);
  });

  it('includes all optional fields in correct order', () => {
    const agent = makeAgent({
      model: 'claude-sonnet-4',
      tools: ['Read'],
      disallowedTools: ['Edit'],
      maxTurns: 25,
      background: false,
    });
    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');

    const content = output.content;
    const nameIdx = content.indexOf('name:');
    const descIdx = content.indexOf('description:');
    const modelIdx = content.indexOf('model:');
    const toolsIdx = content.indexOf('tools:');
    const disallowedIdx = content.indexOf('disallowed-tools:');
    const maxTurnsIdx = content.indexOf('max-turns:');
    const backgroundIdx = content.indexOf('background:');

    expect(nameIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(disallowedIdx);
    expect(disallowedIdx).toBeLessThan(maxTurnsIdx);
    expect(maxTurnsIdx).toBeLessThan(backgroundIdx);
  });
});

// ---------------------------------------------------------------------------
// Native agent passthrough
// ---------------------------------------------------------------------------

describe('nativeAgentPassthrough', () => {
  it('returns TranspiledOutput for matching Copilot agent', () => {
    const item = makeDiscoveredAgentItem({
      format: 'native:github-copilot',
      name: 'my-agent',
      rawContent: 'Native copilot agent content',
    });

    const output = nativeAgentPassthrough(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('my-agent.agent.md');
    expect(output!.content).toBe('Native copilot agent content');
    expect(output!.outputDir).toBe('.github/agents');
    expect(output!.mode).toBe('write');
  });

  it('returns TranspiledOutput for matching Claude Code agent', () => {
    const item = makeDiscoveredAgentItem({
      format: 'native:claude-code',
      name: 'my-agent',
      rawContent: 'Native claude code agent content',
    });

    const output = nativeAgentPassthrough(item, 'claude-code');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('my-agent.md');
    expect(output!.content).toBe('Native claude code agent content');
    expect(output!.outputDir).toBe('.claude/agents');
    expect(output!.mode).toBe('write');
  });

  it('returns null for non-matching agent', () => {
    const item = makeDiscoveredAgentItem({ format: 'native:github-copilot' });

    expect(nativeAgentPassthrough(item, 'claude-code')).toBeNull();
    expect(nativeAgentPassthrough(item, 'cursor')).toBeNull();
    expect(nativeAgentPassthrough(item, 'opencode')).toBeNull();
  });

  it('returns null for agents without agent support', () => {
    const cursorItem = makeDiscoveredAgentItem({
      format: 'native:cursor',
      name: 'test-agent',
      rawContent: 'content',
    });

    expect(nativeAgentPassthrough(cursorItem, 'cursor')).toBeNull();
  });

  it('preserves raw content unchanged', () => {
    const rawContent =
      '---\nname: my-agent\ndescription: An agent\n---\n\nDo something with @file and tools';
    const item = makeDiscoveredAgentItem({
      format: 'native:github-copilot',
      rawContent,
    });

    const output = nativeAgentPassthrough(item, 'github-copilot');

    expect(output!.content).toBe(rawContent);
  });

  it('uses correct extension for each supported agent', () => {
    const agents: Array<[TargetAgent, string, string]> = [
      ['github-copilot', '.agent.md', '.github/agents'],
      ['claude-code', '.md', '.claude/agents'],
      ['opencode', '.md', '.opencode/agents'],
    ];

    for (const [agent, expectedExt, expectedDir] of agents) {
      const item = makeDiscoveredAgentItem({
        format: `native:${agent}`,
        name: 'test-agent',
        rawContent: `content for ${agent}`,
      });

      const output = nativeAgentPassthrough(item, agent);

      expect(output).not.toBeNull();
      expect(output!.filename).toBe(`test-agent${expectedExt}`);
      expect(output!.outputDir).toBe(expectedDir);
    }
  });
});

// ---------------------------------------------------------------------------
// transpileAgent (integrated)
// ---------------------------------------------------------------------------

describe('transpileAgent', () => {
  it('transpiles canonical agent for copilot', () => {
    const item = makeDiscoveredAgentItem();
    const output = transpileAgent(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('architect.agent.md');
    expect(output!.outputDir).toBe('.github/agents');
    expect(output!.content).toContain('name:');
    expect(output!.content).toContain('description:');
  });

  it('transpiles canonical agent for claude-code', () => {
    const item = makeDiscoveredAgentItem();
    const output = transpileAgent(item, 'claude-code');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('architect.md');
    expect(output!.outputDir).toBe('.claude/agents');
    expect(output!.content).toContain('name:');
    expect(output!.content).toContain('description:');
  });

  it('returns null for cursor (unsupported)', () => {
    const item = makeDiscoveredAgentItem();
    const output = transpileAgent(item, 'cursor');

    expect(output).toBeNull();
  });

  it('returns null for windsurf (unsupported)', () => {
    const item = makeDiscoveredAgentItem();
    const output = transpileAgent(item, 'windsurf' as TargetAgent);

    expect(output).toBeNull();
  });

  it('returns null for cline (unsupported)', () => {
    const item = makeDiscoveredAgentItem();
    const output = transpileAgent(item, 'cline' as TargetAgent);

    expect(output).toBeNull();
  });

  it('returns null for invalid canonical content', () => {
    const item = makeDiscoveredAgentItem({ rawContent: '---\n---\n\nNo frontmatter' });

    const output = transpileAgent(item, 'github-copilot');

    expect(output).toBeNull();
  });

  it('uses native passthrough for native format items', () => {
    const item = makeDiscoveredAgentItem({
      format: 'native:github-copilot',
      rawContent: 'Native content',
    });

    const copilotOutput = transpileAgent(item, 'github-copilot');
    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).toBe('Native content');

    const claudeOutput = transpileAgent(item, 'claude-code');
    expect(claudeOutput).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transpileAgentForAllAgents
// ---------------------------------------------------------------------------

describe('transpileAgentForAllAgents', () => {
  it('produces outputs for only supported agents from canonical agent', () => {
    const item = makeDiscoveredAgentItem();
    const outputs = transpileAgentForAllAgents(item, TARGET_AGENTS);

    // Copilot, Claude Code, and OpenCode support canonical agent transpilation
    expect(outputs).toHaveLength(3);

    const dirs = outputs.map((o) => o.outputDir).sort();
    expect(dirs).toEqual(['.claude/agents', '.github/agents', '.opencode/agents']);
  });

  it('produces output for only matching agent from native agent', () => {
    const item = makeDiscoveredAgentItem({
      format: 'native:github-copilot',
      rawContent: 'Copilot-specific content',
    });

    const outputs = transpileAgentForAllAgents(item, TARGET_AGENTS);

    expect(outputs).toHaveLength(1);
    const first = outputs[0]!;
    expect(first.outputDir).toBe('.github/agents');
    expect(first.content).toBe('Copilot-specific content');
  });

  it('handles subset of target agents', () => {
    const item = makeDiscoveredAgentItem();
    const agents: TargetAgent[] = ['github-copilot'];

    const outputs = transpileAgentForAllAgents(item, agents);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.outputDir).toBe('.github/agents');
  });

  it('returns empty array for native agent with no matching agent in subset', () => {
    const item = makeDiscoveredAgentItem({ format: 'native:github-copilot' });

    const outputs = transpileAgentForAllAgents(item, ['cursor']);

    expect(outputs).toHaveLength(0);
  });

  it('returns empty array for unsupported agents only', () => {
    const item = makeDiscoveredAgentItem();
    const agents: TargetAgent[] = ['cursor'];

    const outputs = transpileAgentForAllAgents(item, agents);

    expect(outputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

describe('agentTranspilers registry', () => {
  it('has entries for Copilot, Claude Code, and OpenCode only', () => {
    expect(Object.keys(agentTranspilers).sort()).toEqual([
      'claude-code',
      'github-copilot',
      'opencode',
    ]);
  });

  it('does not have entries for cursor, windsurf, or cline', () => {
    expect(agentTranspilers['cursor' as TargetAgent]).toBeUndefined();
    expect(agentTranspilers['windsurf' as TargetAgent]).toBeUndefined();
    expect(agentTranspilers['cline' as TargetAgent]).toBeUndefined();
  });

  it('all entries implement canTranspile and transform', () => {
    for (const [, transpiler] of Object.entries(agentTranspilers)) {
      expect(typeof transpiler.canTranspile).toBe('function');
      expect(typeof transpiler.transform).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Model alias resolution in transpileAgent
// ---------------------------------------------------------------------------

describe('model alias resolution', () => {
  it('resolves claude-haiku-3.5 to agent-specific name for copilot', () => {
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        'model: claude-haiku-3.5',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'github-copilot');

    expect(output).not.toBeNull();
    // claude-haiku-3.5 should be resolved to claude-3.5-haiku for Copilot
    expect(output!.content).toContain('model: "claude-3.5-haiku"');
    expect(output!.content).not.toContain('claude-haiku-3.5');
  });

  it('resolves claude-haiku-3.5 to agent-specific name for claude-code', () => {
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        'model: claude-haiku-3.5',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'claude-code');

    expect(output).not.toBeNull();
    // claude-haiku-3.5 should be resolved to claude-3-5-haiku-latest for Claude Code
    expect(output!.content).toContain('model: "claude-3-5-haiku-latest"');
    expect(output!.content).not.toContain('claude-haiku-3.5');
  });

  it('keeps claude-sonnet-4 as-is for copilot (identity mapping)', () => {
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        'model: claude-sonnet-4',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.content).toContain('model: "claude-sonnet-4"');
  });

  it('drops model for unknown model name', () => {
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        'model: totally-unknown-model',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'github-copilot');

    expect(output).not.toBeNull();
    // Unknown model should be dropped
    expect(output!.content).not.toMatch(/^model:/m);
  });

  it('drops model when agent does not support that model', () => {
    // gpt-4o maps to null for claude-code (OpenAI model not available)
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        'model: gpt-4o',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'claude-code');

    expect(output).not.toBeNull();
    // gpt-4o is not available on claude-code, model should be omitted
    expect(output!.content).not.toMatch(/^model:/m);
  });

  it('preserves agent without model field unchanged', () => {
    const item = makeDiscoveredAgentItem({
      rawContent: [
        '---',
        'name: architect',
        'description: Senior architect for system design and code review',
        '---',
        '',
        'You are a senior software architect...',
      ].join('\n'),
    });

    const output = transpileAgent(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.content).not.toMatch(/^model:/m);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles agent with empty body', () => {
    const agent = makeAgent({ body: '' });

    const copilotOutput = copilotAgentTranspiler.transform(agent, 'github-copilot');
    expect(copilotOutput.content).toBeDefined();

    const claudeOutput = claudeCodeAgentTranspiler.transform(agent, 'claude-code');
    expect(claudeOutput.content).toBeDefined();
  });

  it('handles agent with very long body', () => {
    const body = 'x'.repeat(10000);
    const agent = makeAgent({ body });

    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');
    expect(output.content).toContain(body);
  });

  it('preserves markdown formatting in body', () => {
    const body = [
      '## Architecture Guidelines',
      '',
      '- Follow SOLID principles',
      '- Use dependency injection',
      '',
      '```typescript',
      'interface Service {}',
      '```',
    ].join('\n');
    const agent = makeAgent({ body });

    const copilotOutput = copilotAgentTranspiler.transform(agent, 'github-copilot');
    expect(copilotOutput.content).toContain('## Architecture Guidelines');
    expect(copilotOutput.content).toContain('```typescript');

    const claudeOutput = claudeCodeAgentTranspiler.transform(agent, 'claude-code');
    expect(claudeOutput.content).toContain('## Architecture Guidelines');
    expect(claudeOutput.content).toContain('```typescript');
  });

  it('handles agent name with numbers', () => {
    const agent = makeAgent({ name: 'reviewer-v2' });

    const output = copilotAgentTranspiler.transform(agent, 'github-copilot');
    expect(output.filename).toBe('reviewer-v2.agent.md');
  });

  it('handles agent with only required fields', () => {
    const agent = makeAgent({
      model: undefined,
      tools: undefined,
      disallowedTools: undefined,
      maxTurns: undefined,
      background: undefined,
    });

    const copilotOutput = copilotAgentTranspiler.transform(agent, 'github-copilot');
    expect(copilotOutput.content).toContain('name:');
    expect(copilotOutput.content).toContain('description:');
    expect(copilotOutput.content).not.toMatch(/^model:/m);
    expect(copilotOutput.content).not.toMatch(/^tools:/m);

    const claudeOutput = claudeCodeAgentTranspiler.transform(agent, 'claude-code');
    expect(claudeOutput.content).toContain('name:');
    expect(claudeOutput.content).toContain('description:');
    expect(claudeOutput.content).not.toMatch(/^model:/m);
    expect(claudeOutput.content).not.toMatch(/^tools:/m);
    expect(claudeOutput.content).not.toMatch(/^disallowed-tools:/m);
    expect(claudeOutput.content).not.toMatch(/^max-turns:/m);
    expect(claudeOutput.content).not.toMatch(/^background:/m);
  });

  it('handles agent with all Claude-specific fields', () => {
    const agent = makeAgent({
      model: 'claude-sonnet-4',
      tools: ['Read', 'Grep'],
      disallowedTools: ['Edit'],
      maxTurns: 25,
      background: false,
    });

    const output = claudeCodeAgentTranspiler.transform(agent, 'claude-code');
    expect(output.content).toContain('model: "claude-sonnet-4"');
    expect(output.content).toContain('  - Read');
    expect(output.content).toContain('  - Grep');
    expect(output.content).toContain('disallowed-tools:');
    expect(output.content).toContain('  - Edit');
    expect(output.content).toContain('max-turns: 25');
    expect(output.content).toContain('background: false');
  });
});
