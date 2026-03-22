import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { discover, filterByType, filterByFormat } from './rule-discovery.ts';
import {
  targetAgents,
  TARGET_AGENTS,
  getTargetAgentConfig,
  getOutputDir,
  getRuleExtension,
  getPromptExtension,
  getAgentExtension,
} from './target-agents.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index into an array with a length assertion, avoiding TS "Object is possibly undefined" errors. */
function at<T>(arr: T[], index: number): T {
  expect(arr.length).toBeGreaterThan(index);
  return arr[index]!;
}

function rulemd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

function skillmd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nSkill content here.`;
}

function promptmd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

function agentmd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const VALID_RULE = {
  name: 'code-style',
  description: 'Enforce TypeScript code style conventions',
  globs: ['*.ts', '*.tsx'],
  activation: 'auto',
};

// ---------------------------------------------------------------------------
// Target agents registry tests
// ---------------------------------------------------------------------------

describe('target-agents registry', () => {
  it('has exactly 6 target agents', () => {
    expect(TARGET_AGENTS).toHaveLength(6);
    expect(TARGET_AGENTS).toContain('github-copilot');
    expect(TARGET_AGENTS).toContain('claude-code');
    expect(TARGET_AGENTS).toContain('cursor');
    expect(TARGET_AGENTS).toContain('windsurf');
    expect(TARGET_AGENTS).toContain('cline');
    expect(TARGET_AGENTS).toContain('opencode');
  });

  it('each agent has required config fields', () => {
    for (const agent of TARGET_AGENTS) {
      const config = targetAgents[agent];
      expect(config.name).toBe(agent);
      expect(config.displayName).toBeTruthy();
      expect(config.skillsDir).toBeTruthy();
      expect(config.rulesConfig.outputDir).toBeTruthy();
      expect(config.rulesConfig.extension).toMatch(/^\./);
      expect(config.nativeRuleDiscovery.sourceDir).toBeTruthy();
      expect(config.nativeRuleDiscovery.pattern).toBeTruthy();
    }
  });

  it('maps correct rules output directories', () => {
    expect(targetAgents['github-copilot'].rulesConfig.outputDir).toBe('.github/instructions');
    expect(targetAgents['claude-code'].rulesConfig.outputDir).toBe('.claude/rules');
    expect(targetAgents['cursor'].rulesConfig.outputDir).toBe('.cursor/rules');
    expect(targetAgents['windsurf'].rulesConfig.outputDir).toBe('.windsurf/rules');
    expect(targetAgents['cline'].rulesConfig.outputDir).toBe('.clinerules');
  });

  it('maps correct rules extensions', () => {
    expect(getRuleExtension('github-copilot')).toBe('.instructions.md');
    expect(getRuleExtension('claude-code')).toBe('.md');
    expect(getRuleExtension('cursor')).toBe('.mdc');
    expect(getRuleExtension('windsurf')).toBe('.md');
    expect(getRuleExtension('cline')).toBe('.md');
  });

  it('getTargetAgentConfig returns correct config', () => {
    const config = getTargetAgentConfig('cursor');
    expect(config.name).toBe('cursor');
    expect(config.displayName).toBe('Cursor');
  });

  it('getOutputDir returns skills dir for skills', () => {
    expect(getOutputDir('github-copilot', 'skill')).toBe('.agents/skills');
    expect(getOutputDir('claude-code', 'skill')).toBe('.claude/skills');
    expect(getOutputDir('cursor', 'skill')).toBe('.cursor/skills');
  });

  it('getOutputDir returns rules dir for rules', () => {
    expect(getOutputDir('github-copilot', 'rule')).toBe('.github/instructions');
    expect(getOutputDir('cline', 'rule')).toBe('.clinerules');
  });

  it('getOutputDir returns prompts dir for agents that support prompts', () => {
    expect(getOutputDir('github-copilot', 'prompt')).toBe('.github/prompts');
    expect(getOutputDir('claude-code', 'prompt')).toBe('.claude/commands');
  });

  it('getOutputDir returns undefined for agents that do not support prompts', () => {
    expect(getOutputDir('cursor', 'prompt')).toBeUndefined();
    expect(getOutputDir('windsurf', 'prompt')).toBeUndefined();
    expect(getOutputDir('cline', 'prompt')).toBeUndefined();
  });

  it('maps correct prompt output directories', () => {
    expect(targetAgents['github-copilot'].promptsConfig?.outputDir).toBe('.github/prompts');
    expect(targetAgents['claude-code'].promptsConfig?.outputDir).toBe('.claude/commands');
  });

  it('maps correct prompt extensions', () => {
    expect(getPromptExtension('github-copilot')).toBe('.prompt.md');
    expect(getPromptExtension('claude-code')).toBe('.md');
  });

  it('returns undefined prompt extension for unsupported agents', () => {
    expect(getPromptExtension('cursor')).toBeUndefined();
    expect(getPromptExtension('windsurf')).toBeUndefined();
    expect(getPromptExtension('cline')).toBeUndefined();
  });

  it('agents without promptsConfig have no prompt support', () => {
    expect(targetAgents['cursor'].promptsConfig).toBeUndefined();
    expect(targetAgents['cline'].promptsConfig).toBeUndefined();
  });

  it('windsurf has nativePromptDiscovery but no promptsConfig', () => {
    expect(targetAgents['windsurf'].promptsConfig).toBeUndefined();
    expect(targetAgents['windsurf'].nativePromptDiscovery).toBeDefined();
    expect(targetAgents['windsurf'].nativePromptDiscovery?.sourceDir).toBe('.windsurf/workflows');
    expect(targetAgents['windsurf'].nativePromptDiscovery?.pattern).toBe('*.md');
  });

  it('nativePromptDiscovery paths are correct for supporting agents', () => {
    expect(targetAgents['github-copilot'].nativePromptDiscovery?.sourceDir).toBe('.github/prompts');
    expect(targetAgents['github-copilot'].nativePromptDiscovery?.pattern).toBe('*.prompt.md');
    expect(targetAgents['claude-code'].nativePromptDiscovery?.sourceDir).toBe('.claude/commands');
    expect(targetAgents['claude-code'].nativePromptDiscovery?.pattern).toBe('*.md');
  });

  it('maps correct agent output directories', () => {
    expect(targetAgents['github-copilot'].agentsConfig?.outputDir).toBe('.github/agents');
    expect(targetAgents['claude-code'].agentsConfig?.outputDir).toBe('.claude/agents');
  });

  it('maps correct agent extensions', () => {
    expect(getAgentExtension('github-copilot')).toBe('.agent.md');
    expect(getAgentExtension('claude-code')).toBe('.md');
  });

  it('returns undefined agent extension for unsupported agents', () => {
    expect(getAgentExtension('cursor')).toBeUndefined();
    expect(getAgentExtension('windsurf')).toBeUndefined();
    expect(getAgentExtension('cline')).toBeUndefined();
  });

  it('agents without agentsConfig have no agent support', () => {
    expect(targetAgents['cursor'].agentsConfig).toBeUndefined();
    expect(targetAgents['windsurf'].agentsConfig).toBeUndefined();
    expect(targetAgents['cline'].agentsConfig).toBeUndefined();
  });

  it('getOutputDir returns agents dir for agents that support agents', () => {
    expect(getOutputDir('github-copilot', 'agent')).toBe('.github/agents');
    expect(getOutputDir('claude-code', 'agent')).toBe('.claude/agents');
  });

  it('getOutputDir returns undefined for agents that do not support agents', () => {
    expect(getOutputDir('cursor', 'agent')).toBeUndefined();
    expect(getOutputDir('windsurf', 'agent')).toBeUndefined();
    expect(getOutputDir('cline', 'agent')).toBeUndefined();
  });

  it('nativeAgentDiscovery paths are correct for supporting agents', () => {
    expect(targetAgents['github-copilot'].nativeAgentDiscovery?.sourceDir).toBe('.github/agents');
    expect(targetAgents['github-copilot'].nativeAgentDiscovery?.pattern).toBe('*.agent.md');
    expect(targetAgents['claude-code'].nativeAgentDiscovery?.sourceDir).toBe('.claude/agents');
    expect(targetAgents['claude-code'].nativeAgentDiscovery?.pattern).toBe('*.md');
  });
});

// ---------------------------------------------------------------------------
// Discovery tests
// ---------------------------------------------------------------------------

describe('discover', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dotai-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Empty repo
  // -------------------------------------------------------------------------

  it('returns empty results for empty directory', async () => {
    const result = await discover(testDir);
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Canonical RULES.md discovery
  // -------------------------------------------------------------------------

  describe('canonical rules', () => {
    it('discovers root RULES.md', async () => {
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Rule body'));

      const result = await discover(testDir);
      const rules = filterByType(result.items, 'rule');
      expect(rules).toHaveLength(1);
      expect(at(rules, 0).name).toBe('code-style');
      expect(at(rules, 0).format).toBe('canonical');
      expect(at(rules, 0).type).toBe('rule');
      expect(at(rules, 0).description).toBe('Enforce TypeScript code style conventions');
    });

    it('discovers rules/*/RULES.md', async () => {
      await mkdir(join(testDir, 'rules', 'code-style'), { recursive: true });
      await mkdir(join(testDir, 'rules', 'security'), { recursive: true });
      await writeFile(join(testDir, 'rules', 'code-style', 'RULES.md'), rulemd(VALID_RULE));
      await writeFile(
        join(testDir, 'rules', 'security', 'RULES.md'),
        rulemd({ name: 'security', description: 'Security rules', activation: 'always' })
      );

      const result = await discover(testDir);
      const rules = filterByType(result.items, 'rule');
      expect(rules).toHaveLength(2);
      const names = rules.map((r) => r.name).sort();
      expect(names).toEqual(['code-style', 'security']);
      expect(rules.every((r) => r.format === 'canonical')).toBe(true);
    });

    it('deduplicates by name — root wins over rules/ subdir', async () => {
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Root body'));
      await mkdir(join(testDir, 'rules', 'code-style'), { recursive: true });
      await writeFile(
        join(testDir, 'rules', 'code-style', 'RULES.md'),
        rulemd(VALID_RULE, 'Subdir body')
      );

      const result = await discover(testDir);
      const rules = filterByType(result.items, 'rule');
      expect(rules).toHaveLength(1);
      expect(at(rules, 0).rawContent).toContain('Root body');
    });

    it('warns on invalid frontmatter', async () => {
      await writeFile(join(testDir, 'RULES.md'), rulemd({ name: 123, description: 'test' }));

      const result = await discover(testDir);
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(at(result.warnings, 0).type).toBe('parse-error');
    });

    it('warns on missing required fields', async () => {
      await writeFile(join(testDir, 'RULES.md'), '---\nname: test\n---\n\nNo description');

      const result = await discover(testDir);
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Canonical SKILL.md discovery
  // -------------------------------------------------------------------------

  describe('canonical skills', () => {
    it('discovers root SKILL.md', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A test skill'));

      const result = await discover(testDir);
      const skills = filterByType(result.items, 'skill');
      expect(skills).toHaveLength(1);
      expect(at(skills, 0).name).toBe('my-skill');
      expect(at(skills, 0).format).toBe('canonical');
      expect(at(skills, 0).type).toBe('skill');
    });

    it('discovers skills/*/SKILL.md', async () => {
      await mkdir(join(testDir, 'skills', 'db-migrate'), { recursive: true });
      await mkdir(join(testDir, 'skills', 'api-test'), { recursive: true });
      await writeFile(
        join(testDir, 'skills', 'db-migrate', 'SKILL.md'),
        skillmd('db-migrate', 'Database migration')
      );
      await writeFile(
        join(testDir, 'skills', 'api-test', 'SKILL.md'),
        skillmd('api-test', 'API testing')
      );

      const result = await discover(testDir);
      const skills = filterByType(result.items, 'skill');
      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(['api-test', 'db-migrate']);
    });

    it('deduplicates by name — root wins', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'Root skill'));
      await mkdir(join(testDir, 'skills', 'my-skill'), { recursive: true });
      await writeFile(
        join(testDir, 'skills', 'my-skill', 'SKILL.md'),
        skillmd('my-skill', 'Subdir skill')
      );

      const result = await discover(testDir);
      const skills = filterByType(result.items, 'skill');
      expect(skills).toHaveLength(1);
      expect(at(skills, 0).description).toBe('Root skill');
    });

    it('skips SKILL.md without name', async () => {
      await writeFile(join(testDir, 'SKILL.md'), '---\ndescription: No name\n---\n');

      const result = await discover(testDir);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
    });

    it('skips SKILL.md without description', async () => {
      await writeFile(join(testDir, 'SKILL.md'), '---\nname: test\n---\n');

      const result = await discover(testDir);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Native passthrough rules discovery
  // -------------------------------------------------------------------------

  describe('native rules', () => {
    it('discovers .cursor/rules/*.mdc', async () => {
      await mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'rules', 'code-style.mdc'), 'Cursor rule content');

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:cursor');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('code-style');
      expect(at(nativeRules, 0).type).toBe('rule');
      expect(at(nativeRules, 0).format).toBe('native:cursor');
    });

    it('discovers .github/instructions/*.instructions.md', async () => {
      await mkdir(join(testDir, '.github', 'instructions'), { recursive: true });
      await writeFile(
        join(testDir, '.github', 'instructions', 'code-style.instructions.md'),
        'Copilot instruction'
      );

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:github-copilot');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('code-style');
    });

    it('discovers .claude/rules/*.md', async () => {
      await mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.claude', 'rules', 'style.md'), 'Claude rule');

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:claude-code');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('style');
    });

    it('discovers .windsurf/rules/*.md', async () => {
      await mkdir(join(testDir, '.windsurf', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.windsurf', 'rules', 'lint.md'), 'Windsurf rule');

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:windsurf');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('lint');
    });

    it('discovers .clinerules/*.md', async () => {
      await mkdir(join(testDir, '.clinerules'), { recursive: true });
      await writeFile(join(testDir, '.clinerules', 'safety.md'), 'Cline rule');

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:cline');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('safety');
    });

    it('ignores files that do not match pattern', async () => {
      await mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'rules', 'readme.txt'), 'Not a rule');
      await writeFile(join(testDir, '.cursor', 'rules', 'code-style.mdc'), 'A rule');

      const result = await discover(testDir);
      const nativeRules = filterByFormat(result.items, 'native:cursor');
      expect(nativeRules).toHaveLength(1);
      expect(at(nativeRules, 0).name).toBe('code-style');
    });

    it('ignores non-existent native directories', async () => {
      // No native dirs created
      const result = await discover(testDir);
      expect(result.items).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed discovery
  // -------------------------------------------------------------------------

  describe('mixed discovery', () => {
    it('discovers skills and rules together', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Rule body'));

      const result = await discover(testDir);
      expect(result.items).toHaveLength(2);
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
    });

    it('discovers canonical + native rules together', async () => {
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE));
      await mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'rules', 'lint.mdc'), 'Cursor rule');

      const result = await discover(testDir);
      const rules = filterByType(result.items, 'rule');
      expect(rules).toHaveLength(2);
      expect(filterByFormat(rules, 'canonical')).toHaveLength(1);
      expect(filterByFormat(rules, 'native:cursor')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Caps and limits
  // -------------------------------------------------------------------------

  describe('caps and limits', () => {
    it('caps rules discovery at maxItemsPerType', async () => {
      await mkdir(join(testDir, 'rules'), { recursive: true });
      // Create 5 rules but cap at 3
      for (let i = 0; i < 5; i++) {
        const dir = join(testDir, 'rules', `rule-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'RULES.md'),
          rulemd({ name: `rule-${i}`, description: `Rule ${i}`, activation: 'always' })
        );
      }

      const result = await discover(testDir, { maxItemsPerType: 3 });
      const rules = filterByType(result.items, 'rule');
      expect(rules.length).toBeLessThanOrEqual(3);
      expect(result.warnings.some((w) => w.type === 'cap-reached')).toBe(true);
    });

    it('caps skills discovery at maxItemsPerType', async () => {
      await mkdir(join(testDir, 'skills'), { recursive: true });
      for (let i = 0; i < 5; i++) {
        const dir = join(testDir, 'skills', `skill-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'SKILL.md'), skillmd(`skill-${i}`, `Skill ${i}`));
      }

      const result = await discover(testDir, { maxItemsPerType: 3 });
      const skills = filterByType(result.items, 'skill');
      expect(skills.length).toBeLessThanOrEqual(3);
      expect(result.warnings.some((w) => w.type === 'cap-reached')).toBe(true);
    });

    it('warns on files exceeding maxFileSize', async () => {
      const bigContent = rulemd(VALID_RULE, 'x'.repeat(200));
      await writeFile(join(testDir, 'RULES.md'), bigContent);

      const result = await discover(testDir, { maxFileSize: 50 });
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'file-too-large')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Filter helpers
  // -------------------------------------------------------------------------

  describe('filter helpers', () => {
    it('filterByType returns only matching type', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE));

      const result = await discover(testDir);
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
    });

    it('filterByFormat returns only matching format', async () => {
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE));
      await mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'rules', 'lint.mdc'), 'Cursor native');

      const result = await discover(testDir);
      expect(filterByFormat(result.items, 'canonical')).toHaveLength(1);
      expect(filterByFormat(result.items, 'native:cursor')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Canonical PROMPT.md discovery
  // -------------------------------------------------------------------------

  describe('canonical prompts', () => {
    const VALID_PROMPT = {
      name: 'review-code',
      description: 'Review code for bugs and style issues',
    };

    it('discovers root PROMPT.md', async () => {
      await writeFile(join(testDir, 'PROMPT.md'), promptmd(VALID_PROMPT, 'Review the code.'));

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('review-code');
      expect(at(prompts, 0).format).toBe('canonical');
      expect(at(prompts, 0).type).toBe('prompt');
      expect(at(prompts, 0).description).toBe('Review code for bugs and style issues');
    });

    it('discovers prompts/*/PROMPT.md', async () => {
      await mkdir(join(testDir, 'prompts', 'review-code'), { recursive: true });
      await mkdir(join(testDir, 'prompts', 'gen-tests'), { recursive: true });
      await writeFile(
        join(testDir, 'prompts', 'review-code', 'PROMPT.md'),
        promptmd(VALID_PROMPT, 'Review body')
      );
      await writeFile(
        join(testDir, 'prompts', 'gen-tests', 'PROMPT.md'),
        promptmd({ name: 'gen-tests', description: 'Generate unit tests' }, 'Test body')
      );

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(2);
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual(['gen-tests', 'review-code']);
      expect(prompts.every((p) => p.format === 'canonical')).toBe(true);
    });

    it('deduplicates by name — root wins over prompts/ subdir', async () => {
      await writeFile(join(testDir, 'PROMPT.md'), promptmd(VALID_PROMPT, 'Root body'));
      await mkdir(join(testDir, 'prompts', 'review-code'), { recursive: true });
      await writeFile(
        join(testDir, 'prompts', 'review-code', 'PROMPT.md'),
        promptmd(VALID_PROMPT, 'Subdir body')
      );

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).rawContent).toContain('Root body');
    });

    it('warns on invalid frontmatter', async () => {
      await writeFile(join(testDir, 'PROMPT.md'), promptmd({ name: 123, description: 'test' }));

      const result = await discover(testDir);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(at(result.warnings, 0).type).toBe('parse-error');
    });

    it('warns on missing required fields', async () => {
      await writeFile(join(testDir, 'PROMPT.md'), '---\nname: test\n---\n\nNo description');

      const result = await discover(testDir);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Native passthrough prompts discovery
  // -------------------------------------------------------------------------

  describe('native prompts', () => {
    it('discovers .github/prompts/*.prompt.md', async () => {
      await mkdir(join(testDir, '.github', 'prompts'), { recursive: true });
      await writeFile(
        join(testDir, '.github', 'prompts', 'review-code.prompt.md'),
        'Copilot prompt content'
      );

      const result = await discover(testDir);
      const nativePrompts = filterByFormat(result.items, 'native:github-copilot');
      const prompts = nativePrompts.filter((i) => i.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('review-code');
      expect(at(prompts, 0).type).toBe('prompt');
      expect(at(prompts, 0).format).toBe('native:github-copilot');
    });

    it('discovers .claude/commands/*.md', async () => {
      await mkdir(join(testDir, '.claude', 'commands'), { recursive: true });
      await writeFile(
        join(testDir, '.claude', 'commands', 'gen-tests.md'),
        'Claude command content'
      );

      const result = await discover(testDir);
      const nativePrompts = filterByFormat(result.items, 'native:claude-code');
      const prompts = nativePrompts.filter((i) => i.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('gen-tests');
      expect(at(prompts, 0).type).toBe('prompt');
    });

    it('discovers .windsurf/workflows/*.md', async () => {
      await mkdir(join(testDir, '.windsurf', 'workflows'), { recursive: true });
      await writeFile(
        join(testDir, '.windsurf', 'workflows', 'deploy.md'),
        'Windsurf workflow content'
      );

      const result = await discover(testDir);
      const nativePrompts = filterByFormat(result.items, 'native:windsurf');
      const prompts = nativePrompts.filter((i) => i.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('deploy');
      expect(at(prompts, 0).type).toBe('prompt');
      expect(at(prompts, 0).format).toBe('native:windsurf');
    });

    it('ignores files that do not match prompt pattern', async () => {
      await mkdir(join(testDir, '.github', 'prompts'), { recursive: true });
      await writeFile(join(testDir, '.github', 'prompts', 'readme.txt'), 'Not a prompt');
      await writeFile(join(testDir, '.github', 'prompts', 'review.prompt.md'), 'A prompt');

      const result = await discover(testDir);
      const nativePrompts = filterByFormat(result.items, 'native:github-copilot');
      const prompts = nativePrompts.filter((i) => i.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('review');
    });

    it('does not discover native prompts from agents without nativePromptDiscovery', async () => {
      // Cursor and Cline have no native prompt discovery
      await mkdir(join(testDir, '.cursor', 'prompts'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'prompts', 'test.md'), 'Not discovered');

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Prompt caps and limits
  // -------------------------------------------------------------------------

  describe('prompt caps and limits', () => {
    it('caps prompt discovery at maxItemsPerType', async () => {
      await mkdir(join(testDir, 'prompts'), { recursive: true });
      for (let i = 0; i < 5; i++) {
        const dir = join(testDir, 'prompts', `prompt-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'PROMPT.md'),
          promptmd({ name: `prompt-${i}`, description: `Prompt ${i}` })
        );
      }

      const result = await discover(testDir, { maxItemsPerType: 3 });
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts.length).toBeLessThanOrEqual(3);
      expect(result.warnings.some((w) => w.type === 'cap-reached')).toBe(true);
    });

    it('warns on prompt files exceeding maxFileSize', async () => {
      const bigContent = promptmd(
        { name: 'big-prompt', description: 'A big prompt' },
        'x'.repeat(200)
      );
      await writeFile(join(testDir, 'PROMPT.md'), bigContent);

      const result = await discover(testDir, { maxFileSize: 50 });
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'file-too-large')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed discovery with prompts
  // -------------------------------------------------------------------------

  describe('mixed discovery with prompts', () => {
    it('discovers skills, rules, and prompts together', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Rule body'));
      await writeFile(
        join(testDir, 'PROMPT.md'),
        promptmd({ name: 'my-prompt', description: 'A prompt' }, 'Prompt body')
      );

      const result = await discover(testDir);
      expect(result.items).toHaveLength(3);
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
    });

    it('discovers canonical + native prompts together', async () => {
      await writeFile(
        join(testDir, 'PROMPT.md'),
        promptmd({ name: 'review-code', description: 'Review code' }, 'Review body')
      );
      await mkdir(join(testDir, '.github', 'prompts'), { recursive: true });
      await writeFile(join(testDir, '.github', 'prompts', 'deploy.prompt.md'), 'Copilot prompt');

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(2);
      expect(filterByFormat(prompts, 'canonical')).toHaveLength(1);
      expect(filterByFormat(prompts, 'native:github-copilot')).toHaveLength(1);
    });

    it('filterByType returns only prompts', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE));
      await writeFile(
        join(testDir, 'PROMPT.md'),
        promptmd({ name: 'my-prompt', description: 'A prompt' }, 'Body')
      );

      const result = await discover(testDir);
      const prompts = filterByType(result.items, 'prompt');
      expect(prompts).toHaveLength(1);
      expect(at(prompts, 0).name).toBe('my-prompt');
      expect(at(prompts, 0).type).toBe('prompt');
    });
  });

  // -------------------------------------------------------------------------
  // Canonical AGENT.md discovery
  // -------------------------------------------------------------------------

  describe('canonical agents', () => {
    const VALID_AGENT = {
      name: 'architect',
      description: 'Senior architect for system design and code review',
    };

    it('discovers root AGENT.md', async () => {
      await writeFile(
        join(testDir, 'AGENT.md'),
        agentmd(VALID_AGENT, 'You are a senior architect.')
      );

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).name).toBe('architect');
      expect(at(agents, 0).format).toBe('canonical');
      expect(at(agents, 0).type).toBe('agent');
      expect(at(agents, 0).description).toBe('Senior architect for system design and code review');
    });

    it('discovers agents/*/AGENT.md', async () => {
      await mkdir(join(testDir, 'agents', 'architect'), { recursive: true });
      await mkdir(join(testDir, 'agents', 'reviewer'), { recursive: true });
      await writeFile(
        join(testDir, 'agents', 'architect', 'AGENT.md'),
        agentmd(VALID_AGENT, 'Architect body')
      );
      await writeFile(
        join(testDir, 'agents', 'reviewer', 'AGENT.md'),
        agentmd({ name: 'reviewer', description: 'Code reviewer' }, 'Reviewer body')
      );

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(2);
      const names = agents.map((a) => a.name).sort();
      expect(names).toEqual(['architect', 'reviewer']);
      expect(agents.every((a) => a.format === 'canonical')).toBe(true);
    });

    it('deduplicates by name — root wins over agents/ subdir', async () => {
      await writeFile(join(testDir, 'AGENT.md'), agentmd(VALID_AGENT, 'Root body'));
      await mkdir(join(testDir, 'agents', 'architect'), { recursive: true });
      await writeFile(
        join(testDir, 'agents', 'architect', 'AGENT.md'),
        agentmd(VALID_AGENT, 'Subdir body')
      );

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).rawContent).toContain('Root body');
    });

    it('warns on invalid frontmatter', async () => {
      await writeFile(join(testDir, 'AGENT.md'), agentmd({ name: 123, description: 'test' }));

      const result = await discover(testDir);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(at(result.warnings, 0).type).toBe('parse-error');
    });

    it('warns on missing required fields', async () => {
      await writeFile(join(testDir, 'AGENT.md'), '---\nname: test\n---\n\nNo description');

      const result = await discover(testDir);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Native passthrough agents discovery
  // -------------------------------------------------------------------------

  describe('native agents', () => {
    it('discovers .github/agents/*.agent.md', async () => {
      await mkdir(join(testDir, '.github', 'agents'), { recursive: true });
      await writeFile(
        join(testDir, '.github', 'agents', 'architect.agent.md'),
        'Copilot agent content'
      );

      const result = await discover(testDir);
      const nativeAgents = filterByFormat(result.items, 'native:github-copilot');
      const agents = nativeAgents.filter((i) => i.type === 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).name).toBe('architect');
      expect(at(agents, 0).type).toBe('agent');
      expect(at(agents, 0).format).toBe('native:github-copilot');
    });

    it('discovers .claude/agents/*.md', async () => {
      await mkdir(join(testDir, '.claude', 'agents'), { recursive: true });
      await writeFile(join(testDir, '.claude', 'agents', 'reviewer.md'), 'Claude agent content');

      const result = await discover(testDir);
      const nativeAgents = filterByFormat(result.items, 'native:claude-code');
      const agents = nativeAgents.filter((i) => i.type === 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).name).toBe('reviewer');
      expect(at(agents, 0).type).toBe('agent');
    });

    it('ignores files that do not match agent pattern', async () => {
      await mkdir(join(testDir, '.github', 'agents'), { recursive: true });
      await writeFile(join(testDir, '.github', 'agents', 'readme.txt'), 'Not an agent');
      await writeFile(join(testDir, '.github', 'agents', 'architect.agent.md'), 'An agent');

      const result = await discover(testDir);
      const nativeAgents = filterByFormat(result.items, 'native:github-copilot');
      const agents = nativeAgents.filter((i) => i.type === 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).name).toBe('architect');
    });

    it('does not discover native agents from agents without nativeAgentDiscovery', async () => {
      // Cursor, Windsurf, and Cline have no native agent discovery
      await mkdir(join(testDir, '.cursor', 'agents'), { recursive: true });
      await writeFile(join(testDir, '.cursor', 'agents', 'test.md'), 'Not discovered');

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Agent caps and limits
  // -------------------------------------------------------------------------

  describe('agent caps and limits', () => {
    it('caps agent discovery at maxItemsPerType', async () => {
      await mkdir(join(testDir, 'agents'), { recursive: true });
      for (let i = 0; i < 5; i++) {
        const dir = join(testDir, 'agents', `agent-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'AGENT.md'),
          agentmd({ name: `agent-${i}`, description: `Agent ${i}` })
        );
      }

      const result = await discover(testDir, { maxItemsPerType: 3 });
      const agents = filterByType(result.items, 'agent');
      expect(agents.length).toBeLessThanOrEqual(3);
      expect(result.warnings.some((w) => w.type === 'cap-reached')).toBe(true);
    });

    it('warns on agent files exceeding maxFileSize', async () => {
      const bigContent = agentmd(
        { name: 'big-agent', description: 'A big agent' },
        'x'.repeat(200)
      );
      await writeFile(join(testDir, 'AGENT.md'), bigContent);

      const result = await discover(testDir, { maxFileSize: 50 });
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'file-too-large')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed discovery with agents
  // -------------------------------------------------------------------------

  describe('mixed discovery with agents', () => {
    it('discovers skills, rules, prompts, and agents together', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Rule body'));
      await writeFile(
        join(testDir, 'PROMPT.md'),
        promptmd({ name: 'my-prompt', description: 'A prompt' }, 'Prompt body')
      );
      await writeFile(
        join(testDir, 'AGENT.md'),
        agentmd({ name: 'my-agent', description: 'An agent' }, 'Agent body')
      );

      const result = await discover(testDir);
      expect(result.items).toHaveLength(4);
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
      expect(filterByType(result.items, 'agent')).toHaveLength(1);
    });

    it('discovers canonical + native agents together', async () => {
      await writeFile(
        join(testDir, 'AGENT.md'),
        agentmd({ name: 'architect', description: 'An architect' }, 'Architect body')
      );
      await mkdir(join(testDir, '.github', 'agents'), { recursive: true });
      await writeFile(join(testDir, '.github', 'agents', 'reviewer.agent.md'), 'Copilot agent');

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(2);
      expect(filterByFormat(agents, 'canonical')).toHaveLength(1);
      expect(filterByFormat(agents, 'native:github-copilot')).toHaveLength(1);
    });

    it('filterByType returns only agents', async () => {
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE));
      await writeFile(
        join(testDir, 'AGENT.md'),
        agentmd({ name: 'my-agent', description: 'An agent' }, 'Body')
      );

      const result = await discover(testDir);
      const agents = filterByType(result.items, 'agent');
      expect(agents).toHaveLength(1);
      expect(at(agents, 0).name).toBe('my-agent');
      expect(at(agents, 0).type).toBe('agent');
    });
  });

  // -------------------------------------------------------------------------
  // Type filter — discover() with types option
  // -------------------------------------------------------------------------

  describe('type filter', () => {
    beforeEach(async () => {
      // Set up a repo with all four types
      await writeFile(join(testDir, 'SKILL.md'), skillmd('my-skill', 'A skill'));
      await writeFile(join(testDir, 'RULES.md'), rulemd(VALID_RULE, 'Rule body'));
      await writeFile(
        join(testDir, 'PROMPT.md'),
        promptmd({ name: 'my-prompt', description: 'A prompt' }, 'Prompt body')
      );
      await writeFile(
        join(testDir, 'AGENT.md'),
        agentmd({ name: 'my-agent', description: 'An agent' }, 'Agent body')
      );
    });

    it('discovers all types when types option is omitted', async () => {
      const result = await discover(testDir);
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
      expect(filterByType(result.items, 'agent')).toHaveLength(1);
    });

    it('discovers all types when types is empty array', async () => {
      const result = await discover(testDir, { types: [] });
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
      expect(filterByType(result.items, 'agent')).toHaveLength(1);
    });

    it('discovers only rules when types is ["rule"]', async () => {
      const result = await discover(testDir, { types: ['rule'] });
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
    });

    it('discovers only prompts when types is ["prompt"]', async () => {
      const result = await discover(testDir, { types: ['prompt'] });
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
    });

    it('discovers only agents when types is ["agent"]', async () => {
      const result = await discover(testDir, { types: ['agent'] });
      expect(filterByType(result.items, 'agent')).toHaveLength(1);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
    });

    it('discovers only skills when types is ["skill"]', async () => {
      const result = await discover(testDir, { types: ['skill'] });
      expect(filterByType(result.items, 'skill')).toHaveLength(1);
      expect(filterByType(result.items, 'rule')).toHaveLength(0);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
    });

    it('discovers multiple types when specified', async () => {
      const result = await discover(testDir, { types: ['rule', 'prompt'] });
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(1);
      expect(filterByType(result.items, 'skill')).toHaveLength(0);
      expect(filterByType(result.items, 'agent')).toHaveLength(0);
    });

    it('type filter works with other options', async () => {
      const result = await discover(testDir, { types: ['rule'], maxItemsPerType: 10 });
      expect(filterByType(result.items, 'rule')).toHaveLength(1);
      expect(filterByType(result.items, 'prompt')).toHaveLength(0);
    });
  });
});
