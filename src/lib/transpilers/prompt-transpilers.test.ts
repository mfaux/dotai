import { describe, it, expect } from 'vitest';
import {
  copilotPromptTranspiler,
  claudeCodePromptTranspiler,
  nativePromptPassthrough,
  promptTranspilers,
  transpilePrompt,
  transpilePromptForAllAgents,
} from './prompt-transpilers.ts';
import { TARGET_AGENTS } from '../agents/index.ts';
import type { CanonicalPrompt, DiscoveredItem, TargetAgent } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrompt(overrides: Partial<CanonicalPrompt> = {}): CanonicalPrompt {
  return {
    name: 'review-code',
    description: 'Review code for bugs, performance, and style issues',
    tools: ['Read', 'Grep'],
    schemaVersion: 1,
    body: 'Review the code in @$1 for:\n\n1. Bugs and edge cases\n2. Performance issues\n3. Style violations',
    ...overrides,
  };
}

function makeDiscoveredPromptItem(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
  return {
    type: 'prompt',
    format: 'canonical',
    name: 'review-code',
    description: 'Review code for bugs, performance, and style issues',
    sourcePath: '/repo/prompts/review-code/PROMPT.md',
    rawContent: [
      '---',
      'name: review-code',
      'description: Review code for bugs, performance, and style issues',
      'tools:',
      '  - Read',
      '  - Grep',
      '---',
      '',
      'Review the code in @$1 for:',
      '',
      '1. Bugs and edge cases',
      '2. Performance issues',
      '3. Style violations',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canTranspile
// ---------------------------------------------------------------------------

describe('canTranspile', () => {
  const canonicalPrompt = makeDiscoveredPromptItem();
  const nativePrompt = makeDiscoveredPromptItem({ format: 'native:github-copilot' });
  const skillItem = makeDiscoveredPromptItem({ type: 'skill' });
  const agentItem = makeDiscoveredPromptItem({ type: 'agent' });

  it.each([
    ['copilot', copilotPromptTranspiler],
    ['claude-code', claudeCodePromptTranspiler],
  ] as const)('%s accepts canonical prompts', (_name, transpiler) => {
    expect(transpiler.canTranspile(canonicalPrompt)).toBe(true);
  });

  it.each([
    ['copilot', copilotPromptTranspiler],
    ['claude-code', claudeCodePromptTranspiler],
  ] as const)('%s rejects native prompts', (_name, transpiler) => {
    expect(transpiler.canTranspile(nativePrompt)).toBe(false);
  });

  it.each([
    ['copilot', copilotPromptTranspiler],
    ['claude-code', claudeCodePromptTranspiler],
  ] as const)('%s rejects skill items', (_name, transpiler) => {
    expect(transpiler.canTranspile(skillItem)).toBe(false);
  });

  it.each([
    ['copilot', copilotPromptTranspiler],
    ['claude-code', claudeCodePromptTranspiler],
  ] as const)('%s rejects agent items', (_name, transpiler) => {
    expect(transpiler.canTranspile(agentItem)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copilot prompt transpiler
// ---------------------------------------------------------------------------

describe('Copilot prompt transpiler', () => {
  it('produces .prompt.md file in .github/prompts/', () => {
    const prompt = makePrompt();
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.filename).toBe('review-code.prompt.md');
    expect(output.outputDir).toBe('.github/prompts');
    expect(output.mode).toBe('write');
  });

  it('includes description in frontmatter', () => {
    const prompt = makePrompt();
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain(
      'description: "Review code for bugs, performance, and style issues"'
    );
  });

  it('includes agent in frontmatter when present', () => {
    const prompt = makePrompt({ agent: 'plan' });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain('agent: "plan"');
  });

  it('includes model in frontmatter when present', () => {
    const prompt = makePrompt({ model: 'claude-sonnet-4' });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain('model: "claude-sonnet-4"');
  });

  it('includes argumentHint in frontmatter when present', () => {
    const prompt = makePrompt({ argumentHint: '<file-or-directory>' });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain('argumentHint: "<file-or-directory>"');
  });

  it('includes tools array in frontmatter when present', () => {
    const prompt = makePrompt({ tools: ['Read', 'Grep', 'Write'] });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain('tools:');
    expect(output.content).toContain('  - Read');
    expect(output.content).toContain('  - Grep');
    expect(output.content).toContain('  - Write');
  });

  it('omits agent when absent', () => {
    const prompt = makePrompt({ agent: undefined });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).not.toMatch(/^agent:/m);
  });

  it('omits model when absent', () => {
    const prompt = makePrompt({ model: undefined });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).not.toMatch(/^model:/m);
  });

  it('omits argumentHint when absent', () => {
    const prompt = makePrompt({ argumentHint: undefined });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).not.toMatch(/^argumentHint:/m);
  });

  it('omits tools when empty', () => {
    const prompt = makePrompt({ tools: [] });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).not.toMatch(/^tools:/m);
  });

  it('body passed through unchanged', () => {
    const body = 'Review the code in @$1 for:\n\n1. Bugs\n\n!`git diff --cached`';
    const prompt = makePrompt({ body });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toContain(body);
  });

  it('includes all optional fields in correct order', () => {
    const prompt = makePrompt({
      agent: 'plan',
      model: 'claude-sonnet-4',
      argumentHint: '<file>',
      tools: ['Read'],
    });
    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    // Verify frontmatter structure
    const content = output.content;
    const descIdx = content.indexOf('description:');
    const agentIdx = content.indexOf('agent:');
    const modelIdx = content.indexOf('model:');
    const hintIdx = content.indexOf('argumentHint:');
    const toolsIdx = content.indexOf('tools:');

    expect(descIdx).toBeLessThan(agentIdx);
    expect(agentIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(hintIdx);
    expect(hintIdx).toBeLessThan(toolsIdx);
  });
});

// ---------------------------------------------------------------------------
// Claude Code prompt transpiler
// ---------------------------------------------------------------------------

describe('Claude Code prompt transpiler', () => {
  it('produces .md file in .claude/commands/', () => {
    const prompt = makePrompt();
    const output = claudeCodePromptTranspiler.transform(prompt, 'claude-code');

    expect(output.filename).toBe('review-code.md');
    expect(output.outputDir).toBe('.claude/commands');
    expect(output.mode).toBe('write');
  });

  it('includes description as blockquote', () => {
    const prompt = makePrompt();
    const output = claudeCodePromptTranspiler.transform(prompt, 'claude-code');

    expect(output.content).toContain('> Review code for bugs, performance, and style issues');
  });

  it('body passed through unchanged', () => {
    const body =
      'Review the code in @$1 for:\n\n1. Bugs\n\nUse $ARGUMENTS for additional criteria.\n\n!`git diff --cached`';
    const prompt = makePrompt({ body });
    const output = claudeCodePromptTranspiler.transform(prompt, 'claude-code');

    expect(output.content).toContain(body);
  });

  it('description blockquote appears before body', () => {
    const prompt = makePrompt({ description: 'My description', body: 'My body content' });
    const output = claudeCodePromptTranspiler.transform(prompt, 'claude-code');

    const descIdx = output.content.indexOf('> My description');
    const bodyIdx = output.content.indexOf('My body content');
    expect(descIdx).toBeLessThan(bodyIdx);
  });

  it('handles empty body', () => {
    const prompt = makePrompt({ body: '' });
    const output = claudeCodePromptTranspiler.transform(prompt, 'claude-code');

    expect(output.content).toContain('> Review code for bugs');
    expect(output.content).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Native prompt passthrough
// ---------------------------------------------------------------------------

describe('nativePromptPassthrough', () => {
  it('returns TranspiledOutput for matching Copilot agent', () => {
    const item = makeDiscoveredPromptItem({
      format: 'native:github-copilot',
      name: 'my-prompt',
      rawContent: 'Native copilot prompt content',
    });

    const output = nativePromptPassthrough(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('my-prompt.prompt.md');
    expect(output!.content).toBe('Native copilot prompt content');
    expect(output!.outputDir).toBe('.github/prompts');
    expect(output!.mode).toBe('write');
  });

  it('returns TranspiledOutput for matching Claude Code agent', () => {
    const item = makeDiscoveredPromptItem({
      format: 'native:claude-code',
      name: 'my-prompt',
      rawContent: 'Native claude code prompt content',
    });

    const output = nativePromptPassthrough(item, 'claude-code');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('my-prompt.md');
    expect(output!.content).toBe('Native claude code prompt content');
    expect(output!.outputDir).toBe('.claude/commands');
    expect(output!.mode).toBe('write');
  });

  it('returns null for non-matching agent', () => {
    const item = makeDiscoveredPromptItem({ format: 'native:github-copilot' });

    expect(nativePromptPassthrough(item, 'claude-code')).toBeNull();
    expect(nativePromptPassthrough(item, 'cursor')).toBeNull();
    expect(nativePromptPassthrough(item, 'opencode')).toBeNull();
  });

  it('returns null for agents without prompt support', () => {
    const cursorItem = makeDiscoveredPromptItem({
      format: 'native:cursor',
      name: 'test-prompt',
      rawContent: 'content',
    });

    expect(nativePromptPassthrough(cursorItem, 'cursor')).toBeNull();
  });

  it('preserves raw content unchanged', () => {
    const rawContent =
      '---\ndescription: A prompt\n---\n\nDo something with @file and $ARGUMENTS\n\n!`git status`';
    const item = makeDiscoveredPromptItem({
      format: 'native:github-copilot',
      rawContent,
    });

    const output = nativePromptPassthrough(item, 'github-copilot');

    expect(output!.content).toBe(rawContent);
  });

  it('uses correct extension for each supported agent', () => {
    const agents: Array<[TargetAgent, string, string]> = [
      ['github-copilot', '.prompt.md', '.github/prompts'],
      ['claude-code', '.md', '.claude/commands'],
    ];

    for (const [agent, expectedExt, expectedDir] of agents) {
      const item = makeDiscoveredPromptItem({
        format: `native:${agent}`,
        name: 'test-prompt',
        rawContent: `content for ${agent}`,
      });

      const output = nativePromptPassthrough(item, agent);

      expect(output).not.toBeNull();
      expect(output!.filename).toBe(`test-prompt${expectedExt}`);
      expect(output!.outputDir).toBe(expectedDir);
    }
  });
});

// ---------------------------------------------------------------------------
// transpilePrompt (integrated)
// ---------------------------------------------------------------------------

describe('transpilePrompt', () => {
  it('transpiles canonical prompt for copilot', () => {
    const item = makeDiscoveredPromptItem();
    const output = transpilePrompt(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('review-code.prompt.md');
    expect(output!.outputDir).toBe('.github/prompts');
    expect(output!.content).toContain('description:');
  });

  it('transpiles canonical prompt for claude-code', () => {
    const item = makeDiscoveredPromptItem();
    const output = transpilePrompt(item, 'claude-code');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('review-code.md');
    expect(output!.outputDir).toBe('.claude/commands');
    expect(output!.content).toContain('>');
  });

  it('returns null for cursor (unsupported)', () => {
    const item = makeDiscoveredPromptItem();
    const output = transpilePrompt(item, 'cursor');

    expect(output).toBeNull();
  });

  it('returns null for invalid canonical content', () => {
    const item = makeDiscoveredPromptItem({ rawContent: '---\n---\n\nNo frontmatter' });

    const output = transpilePrompt(item, 'github-copilot');

    expect(output).toBeNull();
  });

  it('uses native passthrough for native format items', () => {
    const item = makeDiscoveredPromptItem({
      format: 'native:github-copilot',
      rawContent: 'Native content',
    });

    const copilotOutput = transpilePrompt(item, 'github-copilot');
    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).toBe('Native content');

    const claudeOutput = transpilePrompt(item, 'claude-code');
    expect(claudeOutput).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transpilePromptForAllAgents
// ---------------------------------------------------------------------------

describe('transpilePromptForAllAgents', () => {
  it('produces outputs for only supported agents from canonical prompt', () => {
    const item = makeDiscoveredPromptItem();
    const outputs = transpilePromptForAllAgents(item, TARGET_AGENTS);

    // Copilot, Claude Code, and OpenCode support canonical prompt transpilation
    expect(outputs).toHaveLength(3);

    const dirs = outputs.map((o) => o.outputDir).sort();
    expect(dirs).toEqual(['.claude/commands', '.github/prompts', '.opencode/commands']);
  });

  it('produces output for only matching agent from native prompt', () => {
    const item = makeDiscoveredPromptItem({
      format: 'native:github-copilot',
      rawContent: 'Copilot-specific content',
    });

    const outputs = transpilePromptForAllAgents(item, TARGET_AGENTS);

    expect(outputs).toHaveLength(1);
    const first = outputs[0]!;
    expect(first.outputDir).toBe('.github/prompts');
    expect(first.content).toBe('Copilot-specific content');
  });

  it('handles subset of target agents', () => {
    const item = makeDiscoveredPromptItem();
    const agents: TargetAgent[] = ['github-copilot'];

    const outputs = transpilePromptForAllAgents(item, agents);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.outputDir).toBe('.github/prompts');
  });

  it('returns empty array for native prompt with no matching agent in subset', () => {
    const item = makeDiscoveredPromptItem({ format: 'native:github-copilot' });

    const outputs = transpilePromptForAllAgents(item, ['cursor']);

    expect(outputs).toHaveLength(0);
  });

  it('returns empty array for unsupported agents only', () => {
    const item = makeDiscoveredPromptItem();
    const agents: TargetAgent[] = ['cursor'];

    const outputs = transpilePromptForAllAgents(item, agents);

    expect(outputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

describe('promptTranspilers registry', () => {
  it('has entries for Copilot, Claude Code, and OpenCode', () => {
    expect(Object.keys(promptTranspilers).sort()).toEqual([
      'claude-code',
      'github-copilot',
      'opencode',
    ]);
  });

  it('does not have entries for cursor', () => {
    expect(promptTranspilers['cursor' as TargetAgent]).toBeUndefined();
  });

  it('all entries implement canTranspile and transform', () => {
    for (const [, transpiler] of Object.entries(promptTranspilers)) {
      expect(typeof transpiler.canTranspile).toBe('function');
      expect(typeof transpiler.transform).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Model alias resolution in transpilePrompt
// ---------------------------------------------------------------------------

describe('model alias resolution', () => {
  it('resolves claude-haiku-3.5 to agent-specific name for copilot', () => {
    const item = makeDiscoveredPromptItem({
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        'model: claude-haiku-3.5',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    });

    const output = transpilePrompt(item, 'github-copilot');

    expect(output).not.toBeNull();
    // claude-haiku-3.5 should be resolved to claude-3.5-haiku for Copilot
    expect(output!.content).toContain('model: "claude-3.5-haiku"');
    expect(output!.content).not.toContain('claude-haiku-3.5');
  });

  it('drops model for unknown model name', () => {
    const item = makeDiscoveredPromptItem({
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        'model: totally-unknown-model',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    });

    const output = transpilePrompt(item, 'github-copilot');

    expect(output).not.toBeNull();
    // Unknown model should be dropped
    expect(output!.content).not.toMatch(/^model:/m);
  });

  it('claude-code ignores model field (not in its output format)', () => {
    // Claude Code prompts are blockquote + body, model is not in the output
    const item = makeDiscoveredPromptItem({
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        'model: claude-sonnet-4',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    });

    const output = transpilePrompt(item, 'claude-code');

    expect(output).not.toBeNull();
    // Claude Code prompt format doesn't include model in output
    expect(output!.content).not.toMatch(/^model:/m);
  });

  it('preserves prompt without model field unchanged', () => {
    const item = makeDiscoveredPromptItem({
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    });

    const output = transpilePrompt(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.content).not.toMatch(/^model:/m);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles prompt with empty body', () => {
    const prompt = makePrompt({ body: '' });

    const copilotOutput = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(copilotOutput.content).toBeDefined();

    const claudeOutput = claudeCodePromptTranspiler.transform(prompt, 'claude-code');
    expect(claudeOutput.content).toBeDefined();
  });

  it('handles prompt with very long body', () => {
    const body = 'x'.repeat(10000);
    const prompt = makePrompt({ body });

    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(output.content).toContain(body);
  });

  it('preserves markdown formatting in body', () => {
    const body = [
      '## Review Steps',
      '',
      '- Check for bugs',
      '- Check performance',
      '',
      '```typescript',
      'const x = 1;',
      '```',
      '',
      'Use $ARGUMENTS for context.',
      '',
      '!`git diff --cached`',
    ].join('\n');
    const prompt = makePrompt({ body });

    const copilotOutput = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(copilotOutput.content).toContain('## Review Steps');
    expect(copilotOutput.content).toContain('```typescript');
    expect(copilotOutput.content).toContain('$ARGUMENTS');
    expect(copilotOutput.content).toContain('!`git diff --cached`');

    const claudeOutput = claudeCodePromptTranspiler.transform(prompt, 'claude-code');
    expect(claudeOutput.content).toContain('## Review Steps');
    expect(claudeOutput.content).toContain('$ARGUMENTS');
  });

  it('handles prompt name with numbers', () => {
    const prompt = makePrompt({ name: 'review-v2' });

    const output = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(output.filename).toBe('review-v2.prompt.md');
  });

  it('preserves $ARGUMENTS, $1, @path, and !`cmd` syntax in body', () => {
    const body =
      'Review @src/main.ts for $1 issues.\n\nUse $ARGUMENTS for details.\n\nRecent changes:\n!`git log --oneline -5`';
    const prompt = makePrompt({ body });

    const copilotOutput = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(copilotOutput.content).toContain('$ARGUMENTS');
    expect(copilotOutput.content).toContain('$1');
    expect(copilotOutput.content).toContain('@src/main.ts');
    expect(copilotOutput.content).toContain('!`git log --oneline -5`');

    const claudeOutput = claudeCodePromptTranspiler.transform(prompt, 'claude-code');
    expect(claudeOutput.content).toContain('$ARGUMENTS');
    expect(claudeOutput.content).toContain('$1');
    expect(claudeOutput.content).toContain('@src/main.ts');
    expect(claudeOutput.content).toContain('!`git log --oneline -5`');
  });

  it('handles prompt with only required fields', () => {
    const prompt = makePrompt({
      agent: undefined,
      model: undefined,
      argumentHint: undefined,
      tools: [],
    });

    const copilotOutput = copilotPromptTranspiler.transform(prompt, 'github-copilot');
    expect(copilotOutput.content).toContain('description:');
    expect(copilotOutput.content).not.toMatch(/^agent:/m);
    expect(copilotOutput.content).not.toMatch(/^model:/m);
    expect(copilotOutput.content).not.toMatch(/^argumentHint:/m);
    expect(copilotOutput.content).not.toMatch(/^tools:/m);

    const claudeOutput = claudeCodePromptTranspiler.transform(prompt, 'claude-code');
    expect(claudeOutput.content).toContain('>');
  });
});
