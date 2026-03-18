import { describe, it, expect } from 'vitest';
import {
  cursorRuleTranspiler,
  windsurfRuleTranspiler,
  clineRuleTranspiler,
  copilotRuleTranspiler,
  claudeCodeRuleTranspiler,
  copilotAppendRuleTranspiler,
  claudeCodeAppendRuleTranspiler,
  nativePassthrough,
  ruleTranspilers,
  appendRuleTranspilers,
  transpileRule,
  transpileRuleForAllAgents,
  quoteYaml,
} from './rule-transpilers.ts';
import { TARGET_AGENTS } from './target-agents.ts';
import type { CanonicalRule, DiscoveredItem, RuleActivation, TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<CanonicalRule> = {}): CanonicalRule {
  return {
    name: 'code-style',
    description: 'Enforce TypeScript code style conventions',
    globs: ['*.ts', '*.tsx'],
    activation: 'auto',
    schemaVersion: 1,
    body: '## TypeScript Code Style\n\n- Use `const` over `let` wherever possible',
    ...overrides,
  };
}

function makeDiscoveredItem(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
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
      '---',
      '',
      '## TypeScript Code Style',
      '',
      '- Use `const` over `let` wherever possible',
    ].join('\n'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canTranspile
// ---------------------------------------------------------------------------

describe('canTranspile', () => {
  const canonicalRule = makeDiscoveredItem();
  const nativeRule = makeDiscoveredItem({ format: 'native:cursor' });
  const skillItem = makeDiscoveredItem({ type: 'skill' });

  it.each([
    ['cursor', cursorRuleTranspiler],
    ['windsurf', windsurfRuleTranspiler],
    ['cline', clineRuleTranspiler],
    ['copilot', copilotRuleTranspiler],
    ['claude-code', claudeCodeRuleTranspiler],
  ] as const)('%s accepts canonical rules', (_name, transpiler) => {
    expect(transpiler.canTranspile(canonicalRule)).toBe(true);
  });

  it.each([
    ['cursor', cursorRuleTranspiler],
    ['windsurf', windsurfRuleTranspiler],
    ['cline', clineRuleTranspiler],
    ['copilot', copilotRuleTranspiler],
    ['claude-code', claudeCodeRuleTranspiler],
  ] as const)('%s rejects native rules', (_name, transpiler) => {
    expect(transpiler.canTranspile(nativeRule)).toBe(false);
  });

  it.each([
    ['cursor', cursorRuleTranspiler],
    ['windsurf', windsurfRuleTranspiler],
    ['cline', clineRuleTranspiler],
    ['copilot', copilotRuleTranspiler],
    ['claude-code', claudeCodeRuleTranspiler],
  ] as const)('%s rejects skill items', (_name, transpiler) => {
    expect(transpiler.canTranspile(skillItem)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cursor transpiler
// ---------------------------------------------------------------------------

describe('Cursor transpiler', () => {
  it('produces .mdc file in .cursor/rules/', () => {
    const rule = makeRule();
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.filename).toBe('code-style.mdc');
    expect(output.outputDir).toBe('.cursor/rules');
    expect(output.mode).toBe('write');
  });

  it('includes description in frontmatter', () => {
    const rule = makeRule();
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('description: "Enforce TypeScript code style conventions"');
  });

  it('sets alwaysApply: true for always activation', () => {
    const rule = makeRule({ activation: 'always' });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('alwaysApply: true');
  });

  it('sets alwaysApply: false for auto activation', () => {
    const rule = makeRule({ activation: 'auto' });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('alwaysApply: false');
  });

  it('sets alwaysApply: false for manual activation', () => {
    const rule = makeRule({ activation: 'manual' });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('alwaysApply: false');
  });

  it('includes comma-separated globs for glob activation', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('globs: *.ts, *.tsx');
    expect(output.content).toContain('alwaysApply: false');
  });

  it('omits globs for non-glob activation', () => {
    const rule = makeRule({ activation: 'always', globs: ['*.ts'] });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).not.toMatch(/^globs:/m);
  });

  it('includes rule body after frontmatter', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).toContain('---\n\nUse const over let.\n');
  });

  it('handles empty globs with glob activation', () => {
    const rule = makeRule({ activation: 'glob', globs: [] });
    const output = cursorRuleTranspiler.transform(rule, 'cursor');

    expect(output.content).not.toMatch(/^globs:/m);
  });
});

// ---------------------------------------------------------------------------
// Windsurf transpiler
// ---------------------------------------------------------------------------

describe('Windsurf transpiler', () => {
  it('produces .md file in .windsurf/rules/', () => {
    const rule = makeRule();
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.filename).toBe('code-style.md');
    expect(output.outputDir).toBe('.windsurf/rules');
    expect(output.mode).toBe('write');
  });

  it('maps always activation to always_on trigger', () => {
    const rule = makeRule({ activation: 'always' });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('trigger: always_on');
  });

  it('maps auto activation to model_decision trigger', () => {
    const rule = makeRule({ activation: 'auto' });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('trigger: model_decision');
  });

  it('maps manual activation to manual trigger', () => {
    const rule = makeRule({ activation: 'manual' });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('trigger: manual');
  });

  it('maps glob activation to glob trigger with globs array', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('trigger: glob');
    expect(output.content).toContain('globs:');
    expect(output.content).toContain('  - "*.ts"');
    expect(output.content).toContain('  - "*.tsx"');
  });

  it('includes description in frontmatter', () => {
    const rule = makeRule();
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('description: "Enforce TypeScript code style conventions"');
  });

  it('omits globs for non-glob activation', () => {
    const rule = makeRule({ activation: 'always', globs: ['*.ts'] });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).not.toMatch(/^globs:/m);
  });

  it('includes rule body after frontmatter', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = windsurfRuleTranspiler.transform(rule, 'windsurf');

    expect(output.content).toContain('---\n\nUse const over let.\n');
  });
});

// ---------------------------------------------------------------------------
// Cline transpiler
// ---------------------------------------------------------------------------

describe('Cline transpiler', () => {
  it('produces .md file in .clinerules/', () => {
    const rule = makeRule();
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.filename).toBe('code-style.md');
    expect(output.outputDir).toBe('.clinerules');
    expect(output.mode).toBe('write');
  });

  it('includes name as heading', () => {
    const rule = makeRule();
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).toContain('# code-style');
  });

  it('includes description as blockquote', () => {
    const rule = makeRule();
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).toContain('> Enforce TypeScript code style conventions');
  });

  it('includes "Applies to" with globs for glob activation', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).toContain('**Applies to:** `*.ts`, `*.tsx`');
  });

  it('omits "Applies to" for non-glob activation', () => {
    const rule = makeRule({ activation: 'always' });
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).not.toContain('Applies to');
  });

  it('includes rule body', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).toContain('Use const over let.');
  });

  it('omits "Applies to" when glob activation but empty globs', () => {
    const rule = makeRule({ activation: 'glob', globs: [] });
    const output = clineRuleTranspiler.transform(rule, 'cline');

    expect(output.content).not.toContain('Applies to');
  });
});

// ---------------------------------------------------------------------------
// Copilot transpiler
// ---------------------------------------------------------------------------

describe('Copilot transpiler', () => {
  it('produces .instructions.md file in .github/instructions/', () => {
    const rule = makeRule();
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.filename).toBe('code-style.instructions.md');
    expect(output.outputDir).toBe('.github/instructions');
    expect(output.mode).toBe('write');
  });

  it('sets applyTo to glob list for glob activation', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('applyTo: "*.ts, *.tsx"');
  });

  it('sets applyTo to ** for always activation', () => {
    const rule = makeRule({ activation: 'always' });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('applyTo: "**"');
  });

  it('sets applyTo to ** for auto activation', () => {
    const rule = makeRule({ activation: 'auto' });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('applyTo: "**"');
  });

  it('sets applyTo to ** for manual activation', () => {
    const rule = makeRule({ activation: 'manual' });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('applyTo: "**"');
  });

  it('includes rule body after frontmatter', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('---\n\nUse const over let.\n');
  });

  it('sets applyTo to ** when glob activation but empty globs', () => {
    const rule = makeRule({ activation: 'glob', globs: [] });
    const output = copilotRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('applyTo: "**"');
  });
});

// ---------------------------------------------------------------------------
// Claude Code transpiler
// ---------------------------------------------------------------------------

describe('Claude Code transpiler', () => {
  it('produces .md file in .claude/rules/', () => {
    const rule = makeRule();
    const output = claudeCodeRuleTranspiler.transform(rule, 'claude-code');

    expect(output.filename).toBe('code-style.md');
    expect(output.outputDir).toBe('.claude/rules');
    expect(output.mode).toBe('write');
  });

  it('includes description in frontmatter', () => {
    const rule = makeRule();
    const output = claudeCodeRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('description: "Enforce TypeScript code style conventions"');
  });

  it('includes globs array when present', () => {
    const rule = makeRule({ globs: ['*.ts', '*.tsx'] });
    const output = claudeCodeRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('globs:');
    expect(output.content).toContain('  - "*.ts"');
    expect(output.content).toContain('  - "*.tsx"');
  });

  it('omits globs when empty', () => {
    const rule = makeRule({ globs: [] });
    const output = claudeCodeRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).not.toMatch(/^globs:/m);
  });

  it('includes rule body after frontmatter', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = claudeCodeRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('---\n\nUse const over let.\n');
  });
});

// ---------------------------------------------------------------------------
// Copilot append transpiler
// ---------------------------------------------------------------------------

describe('Copilot append transpiler', () => {
  it('produces AGENTS.md in project root with append mode', () => {
    const rule = makeRule();
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.filename).toBe('AGENTS.md');
    expect(output.outputDir).toBe('.');
    expect(output.mode).toBe('append');
  });

  it('includes rule name as h2 heading', () => {
    const rule = makeRule();
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('## code-style');
  });

  it('includes description as blockquote', () => {
    const rule = makeRule();
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('> Enforce TypeScript code style conventions');
  });

  it('includes "Applies to" with globs for glob activation', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.ts', '*.tsx'] });
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('**Applies to:** `*.ts`, `*.tsx`');
  });

  it('omits "Applies to" for non-glob activation', () => {
    const rule = makeRule({ activation: 'always' });
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).not.toContain('Applies to');
  });

  it('omits "Applies to" for auto activation', () => {
    const rule = makeRule({ activation: 'auto' });
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).not.toContain('Applies to');
  });

  it('includes rule body', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).toContain('Use const over let.');
  });

  it('omits "Applies to" when glob activation but empty globs', () => {
    const rule = makeRule({ activation: 'glob', globs: [] });
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).not.toContain('Applies to');
  });

  it('has no YAML frontmatter', () => {
    const rule = makeRule();
    const output = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');

    expect(output.content).not.toContain('---');
    expect(output.content).not.toContain('applyTo');
  });

  it('accepts canonical rules in canTranspile', () => {
    const item = makeDiscoveredItem();
    expect(copilotAppendRuleTranspiler.canTranspile(item)).toBe(true);
  });

  it('rejects non-canonical rules in canTranspile', () => {
    const item = makeDiscoveredItem({ format: 'native:cursor' });
    expect(copilotAppendRuleTranspiler.canTranspile(item)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Claude Code append transpiler
// ---------------------------------------------------------------------------

describe('Claude Code append transpiler', () => {
  it('produces CLAUDE.md in project root with append mode', () => {
    const rule = makeRule();
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.filename).toBe('CLAUDE.md');
    expect(output.outputDir).toBe('.');
    expect(output.mode).toBe('append');
  });

  it('includes rule name as h2 heading', () => {
    const rule = makeRule();
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('## code-style');
  });

  it('includes description as blockquote', () => {
    const rule = makeRule();
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('> Enforce TypeScript code style conventions');
  });

  it('includes "Applies to" with globs when present', () => {
    const rule = makeRule({ globs: ['*.ts', '*.tsx'] });
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('**Applies to:** `*.ts`, `*.tsx`');
  });

  it('omits "Applies to" when no globs', () => {
    const rule = makeRule({ globs: [] });
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).not.toContain('Applies to');
  });

  it('includes rule body', () => {
    const rule = makeRule({ body: 'Use const over let.' });
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('Use const over let.');
  });

  it('has no YAML frontmatter', () => {
    const rule = makeRule();
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).not.toContain('---');
    expect(output.content).not.toContain('description:');
  });

  it('shows globs regardless of activation mode', () => {
    // Claude Code append shows globs whenever they exist, regardless of activation
    const rule = makeRule({ activation: 'always', globs: ['*.ts'] });
    const output = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');

    expect(output.content).toContain('**Applies to:** `*.ts`');
  });

  it('accepts canonical rules in canTranspile', () => {
    const item = makeDiscoveredItem();
    expect(claudeCodeAppendRuleTranspiler.canTranspile(item)).toBe(true);
  });

  it('rejects non-canonical rules in canTranspile', () => {
    const item = makeDiscoveredItem({ format: 'native:cursor' });
    expect(claudeCodeAppendRuleTranspiler.canTranspile(item)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Native passthrough
// ---------------------------------------------------------------------------

describe('nativePassthrough', () => {
  it('returns TranspiledOutput for matching agent', () => {
    const item = makeDiscoveredItem({
      format: 'native:cursor',
      name: 'my-rule',
      rawContent: 'Native cursor rule content',
    });

    const output = nativePassthrough(item, 'cursor');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('my-rule.mdc');
    expect(output!.content).toBe('Native cursor rule content');
    expect(output!.outputDir).toBe('.cursor/rules');
    expect(output!.mode).toBe('write');
  });

  it('returns null for non-matching agent', () => {
    const item = makeDiscoveredItem({ format: 'native:cursor' });

    expect(nativePassthrough(item, 'windsurf')).toBeNull();
    expect(nativePassthrough(item, 'cline')).toBeNull();
    expect(nativePassthrough(item, 'github-copilot')).toBeNull();
    expect(nativePassthrough(item, 'claude-code')).toBeNull();
  });

  it('uses correct extension for each agent', () => {
    const agents: Array<[TargetAgent, string, string]> = [
      ['cursor', '.mdc', '.cursor/rules'],
      ['windsurf', '.md', '.windsurf/rules'],
      ['cline', '.md', '.clinerules'],
      ['github-copilot', '.instructions.md', '.github/instructions'],
      ['claude-code', '.md', '.claude/rules'],
    ];

    for (const [agent, expectedExt, expectedDir] of agents) {
      const item = makeDiscoveredItem({
        format: `native:${agent}`,
        name: 'test-rule',
        rawContent: `content for ${agent}`,
      });

      const output = nativePassthrough(item, agent);

      expect(output).not.toBeNull();
      expect(output!.filename).toBe(`test-rule${expectedExt}`);
      expect(output!.outputDir).toBe(expectedDir);
    }
  });

  it('preserves raw content unchanged', () => {
    const rawContent = '---\ncustom: frontmatter\n---\n\nAgent-specific content here';
    const item = makeDiscoveredItem({
      format: 'native:windsurf',
      rawContent,
    });

    const output = nativePassthrough(item, 'windsurf');

    expect(output!.content).toBe(rawContent);
  });
});

// ---------------------------------------------------------------------------
// transpileRule (integrated)
// ---------------------------------------------------------------------------

describe('transpileRule', () => {
  it('transpiles canonical rule for cursor', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'cursor');

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('code-style.mdc');
    expect(output!.outputDir).toBe('.cursor/rules');
    expect(output!.content).toContain('alwaysApply: false');
  });

  it('transpiles canonical rule for all 5 agents', () => {
    const item = makeDiscoveredItem();

    for (const agent of TARGET_AGENTS) {
      const output = transpileRule(item, agent);
      expect(output).not.toBeNull();
      expect(output!.mode).toBe('write');
    }
  });

  it('returns null for invalid canonical content', () => {
    const item = makeDiscoveredItem({ rawContent: '---\n---\n\nNo frontmatter' });

    const output = transpileRule(item, 'cursor');

    expect(output).toBeNull();
  });

  it('uses native passthrough for native format items', () => {
    const item = makeDiscoveredItem({
      format: 'native:cursor',
      rawContent: 'Native content',
    });

    const cursorOutput = transpileRule(item, 'cursor');
    expect(cursorOutput).not.toBeNull();
    expect(cursorOutput!.content).toBe('Native content');

    const windsurfOutput = transpileRule(item, 'windsurf');
    expect(windsurfOutput).toBeNull();
  });

  it('uses append transpiler for copilot when append=true', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'github-copilot', true);

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('AGENTS.md');
    expect(output!.outputDir).toBe('.');
    expect(output!.mode).toBe('append');
    expect(output!.content).toContain('## code-style');
  });

  it('uses append transpiler for claude-code when append=true', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'claude-code', true);

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('CLAUDE.md');
    expect(output!.outputDir).toBe('.');
    expect(output!.mode).toBe('append');
    expect(output!.content).toContain('## code-style');
  });

  it('falls back to per-rule file for cursor when append=true', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'cursor', true);

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('code-style.mdc');
    expect(output!.outputDir).toBe('.cursor/rules');
    expect(output!.mode).toBe('write');
  });

  it('falls back to per-rule file for windsurf when append=true', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'windsurf', true);

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('code-style.md');
    expect(output!.outputDir).toBe('.windsurf/rules');
    expect(output!.mode).toBe('write');
  });

  it('falls back to per-rule file for cline when append=true', () => {
    const item = makeDiscoveredItem();
    const output = transpileRule(item, 'cline', true);

    expect(output).not.toBeNull();
    expect(output!.filename).toBe('code-style.md');
    expect(output!.outputDir).toBe('.clinerules');
    expect(output!.mode).toBe('write');
  });

  it('uses native passthrough even when append=true', () => {
    const item = makeDiscoveredItem({
      format: 'native:github-copilot',
      rawContent: 'Native copilot content',
    });

    const output = transpileRule(item, 'github-copilot', true);
    expect(output).not.toBeNull();
    expect(output!.content).toBe('Native copilot content');
    expect(output!.mode).toBe('write');
  });
});

// ---------------------------------------------------------------------------
// transpileRuleForAllAgents
// ---------------------------------------------------------------------------

describe('transpileRuleForAllAgents', () => {
  it('produces outputs for all 5 agents from canonical rule', () => {
    const item = makeDiscoveredItem();
    const outputs = transpileRuleForAllAgents(item, TARGET_AGENTS);

    expect(outputs).toHaveLength(5);

    const dirs = outputs.map((o) => o.outputDir).sort();
    expect(dirs).toEqual([
      '.claude/rules',
      '.clinerules',
      '.cursor/rules',
      '.github/instructions',
      '.windsurf/rules',
    ]);
  });

  it('produces output for only matching agent from native rule', () => {
    const item = makeDiscoveredItem({
      format: 'native:cursor',
      rawContent: 'Cursor-specific content',
    });

    const outputs = transpileRuleForAllAgents(item, TARGET_AGENTS);

    expect(outputs).toHaveLength(1);
    const first = outputs[0]!;
    expect(first.outputDir).toBe('.cursor/rules');
    expect(first.content).toBe('Cursor-specific content');
  });

  it('handles subset of target agents', () => {
    const item = makeDiscoveredItem();
    const agents: TargetAgent[] = ['cursor', 'cline'];

    const outputs = transpileRuleForAllAgents(item, agents);

    expect(outputs).toHaveLength(2);
    expect(outputs.map((o) => o.outputDir).sort()).toEqual(['.clinerules', '.cursor/rules']);
  });

  it('returns empty array for native rule with no matching agent in subset', () => {
    const item = makeDiscoveredItem({ format: 'native:cursor' });

    const outputs = transpileRuleForAllAgents(item, ['windsurf', 'cline']);

    expect(outputs).toHaveLength(0);
  });

  it('uses append transpilers for copilot and claude-code when append=true', () => {
    const item = makeDiscoveredItem();
    const outputs = transpileRuleForAllAgents(item, TARGET_AGENTS, true);

    expect(outputs).toHaveLength(5);

    const appendOutputs = outputs.filter((o) => o.mode === 'append');
    expect(appendOutputs).toHaveLength(2);

    const appendFiles = appendOutputs.map((o) => o.filename).sort();
    expect(appendFiles).toEqual(['AGENTS.md', 'CLAUDE.md']);

    const writeOutputs = outputs.filter((o) => o.mode === 'write');
    expect(writeOutputs).toHaveLength(3);

    const writeDirs = writeOutputs.map((o) => o.outputDir).sort();
    expect(writeDirs).toEqual(['.clinerules', '.cursor/rules', '.windsurf/rules']);
  });

  it('mixes per-rule and append outputs correctly', () => {
    const item = makeDiscoveredItem();
    const agents: TargetAgent[] = ['github-copilot', 'cursor'];
    const outputs = transpileRuleForAllAgents(item, agents, true);

    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.filename).toBe('AGENTS.md');
    expect(outputs[0]!.mode).toBe('append');
    expect(outputs[1]!.filename).toBe('code-style.mdc');
    expect(outputs[1]!.mode).toBe('write');
  });
});

// ---------------------------------------------------------------------------
// Transpiler registry
// ---------------------------------------------------------------------------

describe('ruleTranspilers registry', () => {
  it('has entries for all 5 target agents', () => {
    expect(Object.keys(ruleTranspilers).sort()).toEqual([...TARGET_AGENTS].sort());
  });

  it('all entries implement canTranspile and transform', () => {
    for (const agent of TARGET_AGENTS) {
      const transpiler = ruleTranspilers[agent];
      expect(typeof transpiler.canTranspile).toBe('function');
      expect(typeof transpiler.transform).toBe('function');
    }
  });
});

describe('appendRuleTranspilers registry', () => {
  it('has entries for copilot and claude-code only', () => {
    expect(Object.keys(appendRuleTranspilers).sort()).toEqual(['claude-code', 'github-copilot']);
  });

  it('all entries implement canTranspile and transform', () => {
    for (const transpiler of Object.values(appendRuleTranspilers)) {
      expect(typeof transpiler!.canTranspile).toBe('function');
      expect(typeof transpiler!.transform).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: activation mapping across all agents
// ---------------------------------------------------------------------------

describe('activation mapping across agents', () => {
  const activations: RuleActivation[] = ['always', 'auto', 'manual', 'glob'];

  it.each(activations)('all transpilers handle "%s" activation without errors', (activation) => {
    const rule = makeRule({
      activation,
      globs: activation === 'glob' ? ['*.ts'] : [],
    });

    for (const agent of TARGET_AGENTS) {
      const output = ruleTranspilers[agent].transform(rule, agent);
      expect(output).toBeDefined();
      expect(output.content.length).toBeGreaterThan(0);
      expect(output.mode).toBe('write');
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles rule with empty body', () => {
    const rule = makeRule({ body: '' });

    for (const agent of TARGET_AGENTS) {
      const output = ruleTranspilers[agent].transform(rule, agent);
      expect(output.content).toBeDefined();
    }
  });

  it('handles rule with very long body', () => {
    const body = 'x'.repeat(10000);
    const rule = makeRule({ body });

    const output = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(output.content).toContain(body);
  });

  it('handles rule with single glob', () => {
    const rule = makeRule({ activation: 'glob', globs: ['*.py'] });

    const cursorOutput = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(cursorOutput.content).toContain('globs: *.py');

    const copilotOutput = copilotRuleTranspiler.transform(rule, 'github-copilot');
    expect(copilotOutput.content).toContain('applyTo: "*.py"');
  });

  it('preserves markdown formatting in body', () => {
    const body = [
      '## Heading',
      '',
      '- List item 1',
      '- List item 2',
      '',
      '```typescript',
      'const x = 1;',
      '```',
    ].join('\n');
    const rule = makeRule({ body });

    for (const agent of TARGET_AGENTS) {
      const output = ruleTranspilers[agent].transform(rule, agent);
      expect(output.content).toContain('## Heading');
      expect(output.content).toContain('```typescript');
    }
  });

  it('handles rule name with numbers', () => {
    const rule = makeRule({ name: 'rule-v2' });

    const output = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(output.filename).toBe('rule-v2.mdc');
  });
});

// ---------------------------------------------------------------------------
// quoteYaml
// ---------------------------------------------------------------------------

describe('quoteYaml', () => {
  it('wraps plain string in double quotes', () => {
    expect(quoteYaml('hello world')).toBe('"hello world"');
  });

  it('escapes internal double quotes', () => {
    expect(quoteYaml('say "hello"')).toBe('"say \\"hello\\""');
  });

  it('escapes backslashes', () => {
    expect(quoteYaml('path\\to\\file')).toBe('"path\\\\to\\\\file"');
  });

  it('handles colons safely', () => {
    expect(quoteYaml('key: value')).toBe('"key: value"');
  });

  it('handles empty string', () => {
    expect(quoteYaml('')).toBe('""');
  });

  it('handles string with mixed special characters', () => {
    expect(quoteYaml('desc: "quoted" and \\backslash')).toBe(
      '"desc: \\"quoted\\" and \\\\backslash"'
    );
  });
});

// ---------------------------------------------------------------------------
// YAML injection prevention
// ---------------------------------------------------------------------------

describe('YAML injection prevention', () => {
  it('descriptions containing colons produce valid YAML in all frontmatter transpilers', () => {
    const rule = makeRule({ description: 'Use this: always follow the rules' });

    // Cursor, Windsurf, Claude Code all use YAML frontmatter with description
    const cursorOutput = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(cursorOutput.content).toContain('description: "Use this: always follow the rules"');

    const windsurfOutput = windsurfRuleTranspiler.transform(rule, 'windsurf');
    expect(windsurfOutput.content).toContain('description: "Use this: always follow the rules"');

    const claudeOutput = claudeCodeRuleTranspiler.transform(rule, 'claude-code');
    expect(claudeOutput.content).toContain('description: "Use this: always follow the rules"');
  });

  it('descriptions containing double quotes are escaped', () => {
    const rule = makeRule({ description: 'Use "strict" mode always' });

    const cursorOutput = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(cursorOutput.content).toContain('description: "Use \\"strict\\" mode always"');

    const windsurfOutput = windsurfRuleTranspiler.transform(rule, 'windsurf');
    expect(windsurfOutput.content).toContain('description: "Use \\"strict\\" mode always"');

    const claudeOutput = claudeCodeRuleTranspiler.transform(rule, 'claude-code');
    expect(claudeOutput.content).toContain('description: "Use \\"strict\\" mode always"');
  });

  it('descriptions containing backslashes are escaped', () => {
    const rule = makeRule({ description: 'Use path\\to\\file format' });

    const cursorOutput = cursorRuleTranspiler.transform(rule, 'cursor');
    expect(cursorOutput.content).toContain('description: "Use path\\\\to\\\\file format"');
  });

  it('append transpilers pass descriptions through as markdown (no YAML quoting)', () => {
    const rule = makeRule({ description: 'Use this: always follow the "rules"' });

    const copilotAppendOutput = copilotAppendRuleTranspiler.transform(rule, 'github-copilot');
    expect(copilotAppendOutput.content).toContain('> Use this: always follow the "rules"');

    const claudeAppendOutput = claudeCodeAppendRuleTranspiler.transform(rule, 'claude-code');
    expect(claudeAppendOutput.content).toContain('> Use this: always follow the "rules"');
  });
});
