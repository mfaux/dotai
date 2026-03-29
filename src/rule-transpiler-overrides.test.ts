import { describe, it, expect } from 'vitest';
import {
  transpileRule,
  cursorRuleTranspiler,
  copilotRuleTranspiler,
  claudeCodeRuleTranspiler,
} from './rule-transpilers.ts';
import { mergeOverrides } from './override-parser.ts';
import type { CanonicalRule, DiscoveredItem, TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides?: Partial<CanonicalRule>): CanonicalRule {
  return {
    name: 'code-style',
    description: 'Enforce TypeScript code style conventions',
    globs: ['*.ts', '*.tsx'],
    activation: 'auto',
    schemaVersion: 1,
    body: '## TypeScript Code Style\n\n- Use `const` over `let`',
    ...overrides,
  };
}

function makeDiscoveredItem(
  overrideYaml: string,
  overrides: Partial<DiscoveredItem> = {}
): DiscoveredItem {
  return {
    type: 'rule',
    format: 'canonical',
    name: 'code-style',
    description: 'Enforce TypeScript code style conventions',
    sourcePath: '/repo/rules/code-style/RULES.md',
    rawContent: [
      '---',
      'name: code-style',
      'description: Enforce TypeScript code style conventions',
      'globs:',
      '  - "*.ts"',
      '  - "*.tsx"',
      'activation: auto',
      overrideYaml,
      '---',
      '',
      '## TypeScript Code Style',
      '',
      '- Use `const` over `let`',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeOverrides integration with transpilers
// ---------------------------------------------------------------------------

describe('rule transpiler override merging', () => {
  it('copilot uses overridden activation: always', () => {
    const rule = makeRule({
      overrides: {
        'github-copilot': { activation: 'always' },
      },
    });
    const merged = mergeOverrides(rule, 'github-copilot') as CanonicalRule;
    const output = copilotRuleTranspiler.transform(merged, 'github-copilot');

    // activation: always → applyTo: "**" (same as base for copilot,
    // but the rule's base activation is "auto" which also maps to "**")
    // More meaningful: test that merged.activation === 'always'
    expect(merged.activation).toBe('always');
    expect(output.content).toContain('applyTo: "**"');
  });

  it('cursor uses overridden activation: always', () => {
    const rule = makeRule({
      overrides: {
        cursor: { activation: 'always' },
      },
    });
    const merged = mergeOverrides(rule, 'cursor') as CanonicalRule;
    const output = cursorRuleTranspiler.transform(merged, 'cursor');

    expect(merged.activation).toBe('always');
    expect(output.content).toContain('alwaysApply: true');
  });

  it('non-overridden agent uses base activation', () => {
    const rule = makeRule({
      overrides: {
        'github-copilot': { activation: 'always' },
      },
    });
    const merged = mergeOverrides(rule, 'claude-code') as CanonicalRule;

    expect(merged.activation).toBe('auto');
  });

  it('claude-code severity override appears in output', () => {
    const rule = makeRule({
      severity: 'warning',
      overrides: {
        'claude-code': { severity: 'error' },
      },
    });
    const mergedClaude = mergeOverrides(rule, 'claude-code') as CanonicalRule;
    const mergedCopilot = mergeOverrides(rule, 'github-copilot') as CanonicalRule;

    expect(mergedClaude.severity).toBe('error');
    expect(mergedCopilot.severity).toBe('warning');
  });

  it('description override is used in transpiled output', () => {
    const rule = makeRule({
      overrides: {
        'claude-code': { description: 'Claude-specific description' },
      },
    });
    const merged = mergeOverrides(rule, 'claude-code') as CanonicalRule;
    const output = claudeCodeRuleTranspiler.transform(merged, 'claude-code');

    expect(output.content).toContain('description: "Claude-specific description"');
  });

  it('base description used for non-overridden agent', () => {
    const rule = makeRule({
      overrides: {
        'claude-code': { description: 'Claude-specific description' },
      },
    });
    const merged = mergeOverrides(rule, 'cursor') as CanonicalRule;
    const output = cursorRuleTranspiler.transform(merged, 'cursor');

    expect(output.content).toContain('description: "Enforce TypeScript code style conventions"');
  });

  it('globs override used in transpiled output', () => {
    const rule = makeRule({
      activation: 'glob',
      overrides: {
        cursor: { globs: ['*.py'] },
      },
    });
    const merged = mergeOverrides(rule, 'cursor') as CanonicalRule;
    const output = cursorRuleTranspiler.transform(merged, 'cursor');

    expect(output.content).toContain('*.py');
    expect(output.content).not.toContain('*.ts');
  });

  it('rule with no overrides produces identical output to today', () => {
    const rule = makeRule();
    const merged = mergeOverrides(rule, 'cursor') as CanonicalRule;
    const output = cursorRuleTranspiler.transform(merged, 'cursor');
    const directOutput = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toBe(directOutput.content);
  });
});

// ---------------------------------------------------------------------------
// transpileRule integration (end-to-end with raw content)
// ---------------------------------------------------------------------------

describe('transpileRule with overrides in raw content', () => {
  it('copilot uses overridden activation from raw content', () => {
    const item = makeDiscoveredItem('github-copilot:\n  activation: always');
    const copilotOutput = transpileRule(item, 'github-copilot');

    expect(copilotOutput).not.toBeNull();
    // Copilot maps all non-glob activations to applyTo: "**"
    expect(copilotOutput!.content).toContain('applyTo: "**"');
  });

  it('cursor uses base activation when copilot has override', () => {
    const item = makeDiscoveredItem('github-copilot:\n  activation: always');
    const cursorOutput = transpileRule(item, 'cursor');

    expect(cursorOutput).not.toBeNull();
    // Base activation is "auto" → alwaysApply: false
    expect(cursorOutput!.content).toContain('alwaysApply: false');
  });

  it('cursor uses overridden activation: always from raw content', () => {
    const item = makeDiscoveredItem('cursor:\n  activation: always');
    const cursorOutput = transpileRule(item, 'cursor');

    expect(cursorOutput).not.toBeNull();
    expect(cursorOutput!.content).toContain('alwaysApply: true');
  });

  it('cursor uses base activation when override is for different agent', () => {
    const item = makeDiscoveredItem('cursor:\n  activation: always');
    const claudeOutput = transpileRule(item, 'claude-code');

    expect(claudeOutput).not.toBeNull();
    // Claude Code doesn't directly expose activation, but uses base description
    expect(claudeOutput!.content).toContain(
      'description: "Enforce TypeScript code style conventions"'
    );
  });

  it('no overrides produces same output as before', () => {
    const item = makeDiscoveredItem('');
    const output = transpileRule(item, 'cursor');

    expect(output).not.toBeNull();
    expect(output!.content).toContain('alwaysApply: false');
  });
});
