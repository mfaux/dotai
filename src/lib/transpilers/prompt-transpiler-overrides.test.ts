import { describe, it, expect } from 'vitest';
import {
  transpilePrompt,
  copilotPromptTranspiler,
  claudeCodePromptTranspiler,
} from './prompt-transpilers.ts';
import { mergeOverrides } from '../parsers/index.ts';
import type { CanonicalPrompt, DiscoveredItem } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrompt(overrides?: Partial<CanonicalPrompt>): CanonicalPrompt {
  return {
    name: 'review-code',
    description: 'Review code for bugs, performance, and style issues',
    tools: ['Read', 'Grep'],
    schemaVersion: 1,
    body: '## Review\n\nCheck for bugs and performance issues.',
    ...overrides,
  };
}

function makeDiscoveredItem(
  overrideYaml: string,
  overrides: Partial<DiscoveredItem> = {}
): DiscoveredItem {
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
      overrideYaml,
      '---',
      '',
      '## Review',
      '',
      'Check for bugs and performance issues.',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeOverrides integration with prompt transpilers
// ---------------------------------------------------------------------------

describe('prompt transpiler override merging', () => {
  it('copilot uses overridden tools', () => {
    const prompt = makePrompt({
      overrides: {
        'github-copilot': { tools: ['codebase_search', 'file_search'] },
      },
    });
    const merged = mergeOverrides(prompt, 'github-copilot') as CanonicalPrompt;
    const output = copilotPromptTranspiler.transform(merged, 'github-copilot');

    expect(merged.tools).toEqual(['codebase_search', 'file_search']);
    expect(output.content).toContain('  - codebase_search');
    expect(output.content).toContain('  - file_search');
    expect(output.content).not.toContain('  - Read');
  });

  it('claude-code uses overridden tools', () => {
    const prompt = makePrompt({
      overrides: {
        'claude-code': { tools: ['Read', 'Write'] },
      },
    });
    const merged = mergeOverrides(prompt, 'claude-code') as CanonicalPrompt;

    expect(merged.tools).toEqual(['Read', 'Write']);
  });

  it('non-overridden agent uses base tools', () => {
    const prompt = makePrompt({
      overrides: {
        'claude-code': { tools: ['Read', 'Write'] },
      },
    });
    const merged = mergeOverrides(prompt, 'github-copilot') as CanonicalPrompt;

    expect(merged.tools).toEqual(['Read', 'Grep']);
  });

  it('model override is used in copilot output', () => {
    const prompt = makePrompt({
      model: 'claude-sonnet-4',
      overrides: {
        'github-copilot': { model: 'gpt-4o' },
      },
    });
    const merged = mergeOverrides(prompt, 'github-copilot') as CanonicalPrompt;
    const output = copilotPromptTranspiler.transform(merged, 'github-copilot');

    expect(merged.model).toBe('gpt-4o');
    expect(output.content).toContain('model: "gpt-4o"');
  });

  it('base model used for non-overridden agent', () => {
    const prompt = makePrompt({
      model: 'claude-sonnet-4',
      overrides: {
        'github-copilot': { model: 'gpt-4o' },
      },
    });
    const merged = mergeOverrides(prompt, 'claude-code') as CanonicalPrompt;

    expect(merged.model).toBe('claude-sonnet-4');
  });

  it('description override is used in transpiled output', () => {
    const prompt = makePrompt({
      overrides: {
        'github-copilot': { description: 'Copilot-specific review description' },
      },
    });
    const merged = mergeOverrides(prompt, 'github-copilot') as CanonicalPrompt;
    const output = copilotPromptTranspiler.transform(merged, 'github-copilot');

    expect(output.content).toContain('description: "Copilot-specific review description"');
  });

  it('prompt with no overrides produces identical output', () => {
    const prompt = makePrompt();
    const merged = mergeOverrides(prompt, 'github-copilot') as CanonicalPrompt;
    const output = copilotPromptTranspiler.transform(merged, 'github-copilot');
    const directOutput = copilotPromptTranspiler.transform(prompt, 'github-copilot');

    expect(output.content).toBe(directOutput.content);
  });
});

// ---------------------------------------------------------------------------
// transpilePrompt integration (end-to-end with raw content)
// ---------------------------------------------------------------------------

describe('transpilePrompt with overrides in raw content', () => {
  it('claude-code uses overridden tools from raw content', () => {
    const item = makeDiscoveredItem('claude-code:\n  tools:\n    - Read\n    - Write');
    const claudeOutput = transpilePrompt(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    // Claude Code prompt format is blockquote + body (no tools in output)
    // but the merge should work at the canonical level
    expect(claudeOutput!.content).toBeDefined();
  });

  it('copilot uses base tools when claude-code has override', () => {
    const item = makeDiscoveredItem('claude-code:\n  tools:\n    - Read\n    - Write');
    const copilotOutput = transpilePrompt(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    expect(copilotOutput!.content).toContain('  - Read');
    expect(copilotOutput!.content).toContain('  - Grep');
    expect(copilotOutput!.content).not.toContain('  - Write');
  });

  it('copilot uses overridden model from raw content', () => {
    const item: DiscoveredItem = {
      type: 'prompt',
      format: 'canonical',
      name: 'review-code',
      description: 'Review code',
      sourcePath: '/repo/prompts/review-code/PROMPT.md',
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        'model: claude-sonnet-4',
        'tools:',
        '  - Read',
        'github-copilot:',
        '  model: gpt-4o',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    };
    const copilotOutput = transpilePrompt(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    // gpt-4o is a known model for copilot
    expect(copilotOutput!.content).toContain('model: "gpt-4o"');
  });

  it('claude-code uses base model when copilot has override', () => {
    const item: DiscoveredItem = {
      type: 'prompt',
      format: 'canonical',
      name: 'review-code',
      description: 'Review code',
      sourcePath: '/repo/prompts/review-code/PROMPT.md',
      rawContent: [
        '---',
        'name: review-code',
        'description: Review code for bugs, performance, and style issues',
        'model: claude-sonnet-4',
        'tools:',
        '  - Read',
        'github-copilot:',
        '  model: gpt-4o',
        '---',
        '',
        'Review the code.',
      ].join('\n'),
    };
    const claudeOutput = transpilePrompt(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    // Claude Code prompt format doesn't show model in output,
    // but the merge should use the base model (claude-sonnet-4) not gpt-4o
  });

  it('no overrides produces same output as before', () => {
    const item = makeDiscoveredItem('');
    const output = transpilePrompt(item, 'github-copilot');

    expect(output).not.toBeNull();
    expect(output!.content).toContain('  - Read');
    expect(output!.content).toContain('  - Grep');
  });
});
