import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DiscoveredItem, LockEntry, TargetAgent } from './types.ts';
import {
  planRuleWrites,
  executeInstallPipeline,
  type InstallPipelineOptions,
} from './rule-installer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid RULES.md content string. */
function makeRuleContent(
  name: string,
  opts: { description?: string; activation?: string; globs?: string[] } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const activation = opts.activation ?? 'always';
  const globLines =
    opts.globs && opts.globs.length > 0
      ? `globs:\n${opts.globs.map((g) => `  - "${g}"`).join('\n')}\n`
      : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    `activation: ${activation}`,
    globLines ? globLines.trimEnd() : null,
    '---',
    '',
    `## ${name}`,
    '',
    `Body content for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Create a DiscoveredItem for a canonical rule. */
function canonicalRule(
  name: string,
  opts: { description?: string; activation?: string; globs?: string[] } = {}
): DiscoveredItem {
  return {
    type: 'rule',
    format: 'canonical',
    name,
    description: opts.description ?? `Description for ${name}`,
    sourcePath: `/fake/source/rules/${name}/RULES.md`,
    rawContent: makeRuleContent(name, opts),
  };
}

/** Create a DiscoveredItem for a native passthrough rule. */
function nativeRule(name: string, agent: TargetAgent): DiscoveredItem {
  return {
    type: 'rule',
    format: `native:${agent}`,
    name,
    description: `Native ${agent} rule`,
    sourcePath: `/fake/source/.${agent}/rules/${name}.md`,
    rawContent: `Native content for ${name}`,
  };
}

/** Create a DiscoveredItem for a skill (should be skipped by pipeline). */
function skillItem(name: string): DiscoveredItem {
  return {
    type: 'skill',
    format: 'canonical',
    name,
    description: `Skill: ${name}`,
    sourcePath: `/fake/source/skills/${name}/SKILL.md`,
    rawContent: `---\nname: ${name}\ndescription: Skill ${name}\n---\nSkill body`,
  };
}

/** Create a minimal valid PROMPT.md content string. */
function makePromptContent(
  name: string,
  opts: { description?: string; agent?: string; tools?: string[] } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const agentLine = opts.agent ? `agent: ${opts.agent}\n` : '';
  const toolLines =
    opts.tools && opts.tools.length > 0
      ? `tools:\n${opts.tools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    agentLine ? agentLine.trimEnd() : null,
    toolLines ? toolLines.trimEnd() : null,
    '---',
    '',
    `Prompt body for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Create a DiscoveredItem for a canonical prompt. */
function canonicalPrompt(
  name: string,
  opts: { description?: string; agent?: string; tools?: string[] } = {}
): DiscoveredItem {
  return {
    type: 'prompt',
    format: 'canonical',
    name,
    description: opts.description ?? `Description for ${name}`,
    sourcePath: `/fake/source/prompts/${name}/PROMPT.md`,
    rawContent: makePromptContent(name, opts),
  };
}

/** Create a DiscoveredItem for a native passthrough prompt. */
function nativePrompt(name: string, agent: TargetAgent): DiscoveredItem {
  return {
    type: 'prompt',
    format: `native:${agent}`,
    name,
    description: `Native ${agent} prompt`,
    sourcePath: `/fake/source/.${agent}/prompts/${name}.md`,
    rawContent: `Native prompt content for ${name}`,
  };
}

/** Create a minimal valid AGENT.md content string. */
function makeAgentContent(
  name: string,
  opts: {
    description?: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    background?: boolean;
  } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const modelLine = opts.model ? `model: ${opts.model}\n` : '';
  const toolLines =
    opts.tools && opts.tools.length > 0
      ? `tools:\n${opts.tools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';
  const disallowedToolLines =
    opts.disallowedTools && opts.disallowedTools.length > 0
      ? `disallowed-tools:\n${opts.disallowedTools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';
  const maxTurnsLine = opts.maxTurns !== undefined ? `max-turns: ${opts.maxTurns}\n` : '';
  const backgroundLine = opts.background !== undefined ? `background: ${opts.background}\n` : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    modelLine ? modelLine.trimEnd() : null,
    toolLines ? toolLines.trimEnd() : null,
    disallowedToolLines ? disallowedToolLines.trimEnd() : null,
    maxTurnsLine ? maxTurnsLine.trimEnd() : null,
    backgroundLine ? backgroundLine.trimEnd() : null,
    '---',
    '',
    `Agent body for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Create a DiscoveredItem for a canonical agent. */
function canonicalAgent(
  name: string,
  opts: {
    description?: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    background?: boolean;
  } = {}
): DiscoveredItem {
  return {
    type: 'agent',
    format: 'canonical',
    name,
    description: opts.description ?? `Description for ${name}`,
    sourcePath: `/fake/source/agents/${name}/AGENT.md`,
    rawContent: makeAgentContent(name, opts),
  };
}

/** Create a DiscoveredItem for a native passthrough agent. */
function nativeAgent(name: string, agent: TargetAgent): DiscoveredItem {
  return {
    type: 'agent',
    format: `native:${agent}`,
    name,
    description: `Native ${agent} agent`,
    sourcePath: `/fake/source/.${agent}/agents/${name}.md`,
    rawContent: `Native agent content for ${name}`,
  };
}

/** Create base pipeline options. */
function baseOptions(
  projectRoot: string,
  overrides: Partial<InstallPipelineOptions> = {}
): InstallPipelineOptions {
  return {
    projectRoot,
    source: 'test/repo',
    lockEntries: [],
    force: false,
    dryRun: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('install-pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dotai-pipeline-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // planRuleWrites
  // -------------------------------------------------------------------------

  describe('planRuleWrites', () => {
    it('transpiles a canonical rule to all 5 agents', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(5);

      const agents = writes.map((w) => w.agent);
      expect(agents).toContain('github-copilot');
      expect(agents).toContain('claude-code');
      expect(agents).toContain('cursor');
      expect(agents).toContain('windsurf');
      expect(agents).toContain('cline');
    });

    it('respects agent subset filter', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor', 'cline'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(2);
      const agents = writes.map((w) => w.agent);
      expect(agents).toContain('cursor');
      expect(agents).toContain('cline');
    });

    it('skips skill items (handled by existing installer)', () => {
      const items = [skillItem('db-migrate')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(0); // skills are silently skipped, not "skipped with reason"
    });

    it('handles native passthrough — only targets matching agent', () => {
      const items = [nativeRule('code-style', 'cursor')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('cursor');
    });

    it('native passthrough produces no output for non-matching agents', () => {
      const items = [nativeRule('code-style', 'cursor')];
      const opts = baseOptions(tmpDir, {
        agents: ['windsurf'] as const,
      });

      const { writes, skipped } = planRuleWrites(items, opts);

      // native:cursor with only windsurf target → transpilation produces no output
      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.reason).toContain('no outputs');
    });

    it('resolves absolute paths correctly', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.planned.absolutePath).toBe(
        join(tmpDir, '.cursor', 'rules', 'code-style.mdc')
      );
    });

    it('attaches correct metadata to planned writes', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor'] as const,
        source: 'acme/repo',
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes[0]!.planned.type).toBe('rule');
      expect(writes[0]!.planned.name).toBe('code-style');
      expect(writes[0]!.planned.format).toBe('canonical');
      expect(writes[0]!.planned.source).toBe('acme/repo');
    });

    it('handles multiple rules in one batch', () => {
      const items = [canonicalRule('code-style'), canonicalRule('security')];
      const opts = baseOptions(tmpDir);

      const { writes } = planRuleWrites(items, opts);

      // 2 rules × 5 agents = 10 writes
      expect(writes).toHaveLength(10);
    });

    it('handles mixed canonical + native rules', () => {
      const items = [canonicalRule('code-style'), nativeRule('lint', 'cursor')];
      const opts = baseOptions(tmpDir);

      const { writes } = planRuleWrites(items, opts);

      // 1 canonical × 5 agents + 1 native × 1 agent = 6
      expect(writes).toHaveLength(6);
    });

    it('skips items with invalid content', () => {
      const badRule: DiscoveredItem = {
        type: 'rule',
        format: 'canonical',
        name: 'bad-rule',
        description: 'Invalid rule',
        sourcePath: '/fake/source/rules/bad-rule/RULES.md',
        rawContent: '---\n---\nNo frontmatter fields',
      };
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites([badRule], opts);

      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.reason).toContain('no outputs');
    });

    it('returns empty for empty input', () => {
      const { writes, skipped } = planRuleWrites([], baseOptions(tmpDir));

      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — dry-run mode
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — dry-run', () => {
    it('reports planned writes without creating files', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { dryRun: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(5);
      expect(result.written).toHaveLength(0);

      // No files should exist on disk
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(false);
    });

    it('dry-run still detects collisions', async () => {
      // Create a pre-existing file
      const conflictDir = join(tmpDir, '.cursor', 'rules');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'code-style.mdc'), 'existing content');

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { dryRun: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0]!.kind).toBe('file-exists');
      expect(result.written).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — real writes
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — writes', () => {
    it('writes transpiled rules to all 5 agent directories', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(5);

      // Verify files exist on disk
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
      expect(existsSync(join(tmpDir, '.windsurf', 'rules', 'code-style.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.clinerules', 'code-style.md'))).toBe(true);
      expect(
        existsSync(join(tmpDir, '.github', 'instructions', 'code-style.instructions.md'))
      ).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'rules', 'code-style.md'))).toBe(true);
    });

    it('creates target directories that do not exist', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { agents: ['cursor'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    });

    it('written files have correct transpiled content', async () => {
      const items = [canonicalRule('code-style', { activation: 'always' })];
      const opts = baseOptions(tmpDir, { agents: ['cursor'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'), 'utf-8');

      // Cursor format has alwaysApply: true for "always" activation
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('description:');
    });

    it('writes multiple rules in one pass', async () => {
      const items = [canonicalRule('code-style'), canonicalRule('security')];
      const opts = baseOptions(tmpDir, { agents: ['cursor'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(2);
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'security.mdc'))).toBe(true);
    });

    it('succeeds with empty item list', async () => {
      const result = await executeInstallPipeline([], baseOptions(tmpDir));

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(0);
      expect(result.written).toHaveLength(0);
    });

    it('skips skills without error', async () => {
      const items = [skillItem('db-migrate')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(0);
      expect(result.written).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — collision handling
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — collisions', () => {
    it('blocks on pre-existing user file', async () => {
      const conflictDir = join(tmpDir, '.cursor', 'rules');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'code-style.mdc'), 'user content');

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(false);
      expect(result.collisions.length).toBeGreaterThan(0);
      expect(result.error).toContain('collision');
      expect(result.written).toHaveLength(0);
    });

    it('--force overrides pre-existing file', async () => {
      const conflictDir = join(tmpDir, '.cursor', 'rules');
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, 'code-style.mdc'), 'user content');

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { force: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.collisions.length).toBeGreaterThan(0);
      expect(result.written).toHaveLength(5);

      // File should be overwritten with transpiled content
      const content = readFileSync(join(conflictDir, 'code-style.mdc'), 'utf-8');
      expect(content).not.toBe('user content');
    });

    it('blocks on same-name collision from different source', async () => {
      const existingEntry: LockEntry = {
        type: 'rule',
        name: 'code-style',
        source: 'other/repo',
        format: 'canonical',
        agents: ['cursor'],
        hash: 'abc123',
        installedAt: new Date().toISOString(),
        outputs: [join(tmpDir, '.cursor', 'rules', 'code-style.mdc')],
      };

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { lockEntries: [existingEntry] });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(false);
      expect(result.collisions.some((c) => c.kind === 'same-name')).toBe(true);
    });

    it('allows re-install from same source (update path)', async () => {
      const existingEntry: LockEntry = {
        type: 'rule',
        name: 'code-style',
        source: 'test/repo',
        format: 'canonical',
        agents: ['cursor'],
        hash: 'abc123',
        installedAt: new Date().toISOString(),
        outputs: [join(tmpDir, '.cursor', 'rules', 'code-style.mdc')],
      };

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        lockEntries: [existingEntry],
        agents: ['cursor'] as const,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — rollback
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — rollback', () => {
    it('rolls back all writes if a write fails', async () => {
      // Write cursor rule first, then make the windsurf dir read-only to trigger failure
      // We'll simulate this by writing to a path that can't be created
      const items = [canonicalRule('code-style')];

      // Create a file where a directory is expected to force a write error
      const blockerPath = join(tmpDir, '.windsurf');
      writeFileSync(blockerPath, 'I am a file, not a directory');

      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.written).toHaveLength(0);

      // Files written before the failure should have been cleaned up
      // (cursor writes happen before windsurf in the write order)
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — agent filtering
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — agent filtering', () => {
    it('installs only to specified agents', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor', 'cline'] as const,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(2);
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
      expect(existsSync(join(tmpDir, '.clinerules', 'code-style.md'))).toBe(true);
      // Others should NOT exist
      expect(existsSync(join(tmpDir, '.windsurf', 'rules', 'code-style.md'))).toBe(false);
      expect(
        existsSync(join(tmpDir, '.github', 'instructions', 'code-style.instructions.md'))
      ).toBe(false);
      expect(existsSync(join(tmpDir, '.claude', 'rules', 'code-style.md'))).toBe(false);
    });

    it('single agent install', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(1);
      expect(
        existsSync(join(tmpDir, '.github', 'instructions', 'code-style.instructions.md'))
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — native passthrough
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — native passthrough', () => {
    it('installs native rule content unchanged to matching agent', async () => {
      const items = [nativeRule('lint', 'cursor')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(1);

      const content = readFileSync(join(tmpDir, '.cursor', 'rules', 'lint.mdc'), 'utf-8');
      expect(content).toBe('Native content for lint');
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — mixed items
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — mixed items', () => {
    it('handles canonical rules + skills + native rules together', async () => {
      const items = [
        canonicalRule('code-style'),
        skillItem('db-migrate'),
        nativeRule('lint', 'windsurf'),
      ];
      const opts = baseOptions(tmpDir, { agents: ['cursor', 'windsurf'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      // canonical rule: 2 agents = 2 writes
      // skill: skipped (0 writes)
      // native windsurf: 1 write
      expect(result.written).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // planRuleWrites — prompt items
  // -------------------------------------------------------------------------

  describe('planRuleWrites — prompts', () => {
    it('transpiles a canonical prompt to Copilot and Claude Code', () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      // Only Copilot and Claude Code support canonical prompt transpilation
      expect(writes).toHaveLength(2);

      const agents = writes.map((w) => w.agent);
      expect(agents).toContain('github-copilot');
      expect(agents).toContain('claude-code');
    });

    it('respects agent subset filter for prompts', () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('github-copilot');
    });

    it('produces no output for agents that do not support prompts', () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor', 'cline'] as const,
      });

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.reason).toContain('no outputs');
    });

    it('resolves absolute paths correctly for prompts', () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.planned.absolutePath).toBe(
        join(tmpDir, '.github', 'prompts', 'review-code.prompt.md')
      );
    });

    it('attaches correct metadata to prompt planned writes', () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
        source: 'acme/repo',
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes[0]!.planned.type).toBe('prompt');
      expect(writes[0]!.planned.name).toBe('review-code');
      expect(writes[0]!.planned.format).toBe('canonical');
      expect(writes[0]!.planned.source).toBe('acme/repo');
    });

    it('handles multiple prompts in one batch', () => {
      const items = [canonicalPrompt('review-code'), canonicalPrompt('explain-code')];
      const opts = baseOptions(tmpDir);

      const { writes } = planRuleWrites(items, opts);

      // 2 prompts × 2 supported agents = 4 writes
      expect(writes).toHaveLength(4);
    });

    it('handles native prompt passthrough — only targets matching agent', () => {
      const items = [nativePrompt('review', 'github-copilot')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('github-copilot');
    });

    it('native prompt passthrough for windsurf', () => {
      const items = [nativePrompt('deploy', 'windsurf')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('windsurf');
    });

    it('handles mixed rules + prompts + skills together', () => {
      const items = [
        canonicalRule('code-style'),
        canonicalPrompt('review-code'),
        skillItem('db-migrate'),
      ];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      // canonical rule: 5 agents
      // canonical prompt: 2 agents (copilot + claude-code)
      // skill: silently skipped
      expect(writes).toHaveLength(7);
      expect(skipped).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — prompt writes
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — prompt writes', () => {
    it('writes transpiled prompts to Copilot and Claude Code directories', async () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(2);

      // Verify files exist on disk
      expect(existsSync(join(tmpDir, '.github', 'prompts', 'review-code.prompt.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'commands', 'review-code.md'))).toBe(true);
    });

    it('written Copilot prompt has correct content', async () => {
      const items = [canonicalPrompt('review-code', { agent: 'plan' })];
      const opts = baseOptions(tmpDir, { agents: ['github-copilot'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(
        join(tmpDir, '.github', 'prompts', 'review-code.prompt.md'),
        'utf-8'
      );
      expect(content).toContain('description:');
      expect(content).toContain('agent: "plan"');
      expect(content).toContain('Prompt body for review-code.');
    });

    it('written Claude Code prompt has correct content', async () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, { agents: ['claude-code'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, '.claude', 'commands', 'review-code.md'), 'utf-8');
      expect(content).toContain('> Description for review-code');
      expect(content).toContain('Prompt body for review-code.');
    });

    it('dry-run reports prompt writes without creating files', async () => {
      const items = [canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, { dryRun: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(2);
      expect(result.written).toHaveLength(0);
      expect(existsSync(join(tmpDir, '.github', 'prompts', 'review-code.prompt.md'))).toBe(false);
    });

    it('installs native prompt content unchanged', async () => {
      const items = [nativePrompt('deploy', 'github-copilot')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(1);
      const content = readFileSync(join(tmpDir, '.github', 'prompts', 'deploy.prompt.md'), 'utf-8');
      expect(content).toBe('Native prompt content for deploy');
    });

    it('handles mixed rules + prompts in a single pipeline execution', async () => {
      const items = [canonicalRule('code-style'), canonicalPrompt('review-code')];
      const opts = baseOptions(tmpDir, { agents: ['github-copilot', 'claude-code'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      // rule: 2 agents, prompt: 2 agents = 4 writes
      expect(result.written).toHaveLength(4);

      // Rule files
      expect(
        existsSync(join(tmpDir, '.github', 'instructions', 'code-style.instructions.md'))
      ).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'rules', 'code-style.md'))).toBe(true);

      // Prompt files
      expect(existsSync(join(tmpDir, '.github', 'prompts', 'review-code.prompt.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'commands', 'review-code.md'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // planRuleWrites — agent items
  // -------------------------------------------------------------------------

  describe('planRuleWrites — agents', () => {
    it('transpiles a canonical agent to Copilot and Claude Code', () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      // Only Copilot and Claude Code support agent transpilation
      expect(writes).toHaveLength(2);

      const agents = writes.map((w) => w.agent);
      expect(agents).toContain('github-copilot');
      expect(agents).toContain('claude-code');
    });

    it('respects agent subset filter for agents', () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('github-copilot');
    });

    it('produces no output for agents that do not support agent transpilation', () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, {
        agents: ['cursor', 'cline'] as const,
      });

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.reason).toContain('no outputs');
    });

    it('resolves absolute paths correctly for agents', () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.planned.absolutePath).toBe(
        join(tmpDir, '.github', 'agents', 'architect.agent.md')
      );
    });

    it('attaches correct metadata to agent planned writes', () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, {
        agents: ['github-copilot'] as const,
        source: 'acme/repo',
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes[0]!.planned.type).toBe('agent');
      expect(writes[0]!.planned.name).toBe('architect');
      expect(writes[0]!.planned.format).toBe('canonical');
      expect(writes[0]!.planned.source).toBe('acme/repo');
    });

    it('handles multiple agents in one batch', () => {
      const items = [canonicalAgent('architect'), canonicalAgent('reviewer')];
      const opts = baseOptions(tmpDir);

      const { writes } = planRuleWrites(items, opts);

      // 2 agents × 2 supported target agents = 4 writes
      expect(writes).toHaveLength(4);
    });

    it('handles native agent passthrough — only targets matching agent', () => {
      const items = [nativeAgent('architect', 'github-copilot')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('github-copilot');
    });

    it('native agent passthrough for claude-code', () => {
      const items = [nativeAgent('reviewer', 'claude-code')];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]!.agent).toBe('claude-code');
    });

    it('handles mixed rules + prompts + agents + skills together', () => {
      const items = [
        canonicalRule('code-style'),
        canonicalPrompt('review-code'),
        canonicalAgent('architect'),
        skillItem('db-migrate'),
      ];
      const opts = baseOptions(tmpDir);

      const { writes, skipped } = planRuleWrites(items, opts);

      // canonical rule: 5 agents
      // canonical prompt: 2 agents (copilot + claude-code)
      // canonical agent: 2 agents (copilot + claude-code)
      // skill: silently skipped
      expect(writes).toHaveLength(9);
      expect(skipped).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — agent writes
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — agent writes', () => {
    it('writes transpiled agents to Copilot and Claude Code directories', async () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(2);

      // Verify files exist on disk
      expect(existsSync(join(tmpDir, '.github', 'agents', 'architect.agent.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'agents', 'architect.md'))).toBe(true);
    });

    it('written Copilot agent has correct content', async () => {
      const items = [
        canonicalAgent('architect', { model: 'claude-sonnet-4', tools: ['Read', 'Grep'] }),
      ];
      const opts = baseOptions(tmpDir, { agents: ['github-copilot'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(
        join(tmpDir, '.github', 'agents', 'architect.agent.md'),
        'utf-8'
      );
      expect(content).toContain('name: "architect"');
      expect(content).toContain('description:');
      expect(content).toContain('model: "claude-sonnet-4"');
      expect(content).toContain('  - Read');
      expect(content).toContain('  - Grep');
      expect(content).toContain('Agent body for architect.');
    });

    it('written Claude Code agent has correct content', async () => {
      const items = [
        canonicalAgent('architect', {
          tools: ['Read'],
          disallowedTools: ['Edit'],
          maxTurns: 25,
          background: false,
        }),
      ];
      const opts = baseOptions(tmpDir, { agents: ['claude-code'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, '.claude', 'agents', 'architect.md'), 'utf-8');
      expect(content).toContain('name: "architect"');
      expect(content).toContain('description:');
      expect(content).toContain('  - Read');
      expect(content).toContain('disallowed-tools:');
      expect(content).toContain('  - Edit');
      expect(content).toContain('max-turns: 25');
      expect(content).toContain('background: false');
      expect(content).toContain('Agent body for architect.');
    });

    it('dry-run reports agent writes without creating files', async () => {
      const items = [canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, { dryRun: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(2);
      expect(result.written).toHaveLength(0);
      expect(existsSync(join(tmpDir, '.github', 'agents', 'architect.agent.md'))).toBe(false);
    });

    it('installs native agent content unchanged', async () => {
      const items = [nativeAgent('architect', 'github-copilot')];
      const opts = baseOptions(tmpDir);

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(1);
      const content = readFileSync(
        join(tmpDir, '.github', 'agents', 'architect.agent.md'),
        'utf-8'
      );
      expect(content).toBe('Native agent content for architect');
    });

    it('handles mixed rules + prompts + agents in a single pipeline execution', async () => {
      const items = [
        canonicalRule('code-style'),
        canonicalPrompt('review-code'),
        canonicalAgent('architect'),
      ];
      const opts = baseOptions(tmpDir, { agents: ['github-copilot', 'claude-code'] as const });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      // rule: 2 agents, prompt: 2 agents, agent: 2 agents = 6 writes
      expect(result.written).toHaveLength(6);

      // Rule files
      expect(
        existsSync(join(tmpDir, '.github', 'instructions', 'code-style.instructions.md'))
      ).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'rules', 'code-style.md'))).toBe(true);

      // Prompt files
      expect(existsSync(join(tmpDir, '.github', 'prompts', 'review-code.prompt.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'commands', 'review-code.md'))).toBe(true);

      // Agent files
      expect(existsSync(join(tmpDir, '.github', 'agents', 'architect.agent.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.claude', 'agents', 'architect.md'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // planRuleWrites — append mode
  // -------------------------------------------------------------------------

  describe('planRuleWrites — append mode', () => {
    it('produces append outputs for copilot and claude-code with per-rule for others', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { append: true });

      const { writes, skipped } = planRuleWrites(items, opts);

      expect(skipped).toHaveLength(0);
      // 5 agents: copilot (AGENTS.md), claude-code (CLAUDE.md), cursor, windsurf, cline
      expect(writes).toHaveLength(5);

      const copilotWrite = writes.find((w) => w.agent === 'github-copilot');
      expect(copilotWrite).toBeDefined();
      expect(copilotWrite!.planned.output.mode).toBe('append');
      expect(copilotWrite!.planned.output.filename).toBe('AGENTS.md');

      const claudeWrite = writes.find((w) => w.agent === 'claude-code');
      expect(claudeWrite).toBeDefined();
      expect(claudeWrite!.planned.output.mode).toBe('append');
      expect(claudeWrite!.planned.output.filename).toBe('CLAUDE.md');

      // Cursor, Windsurf, Cline remain per-rule file mode
      const cursorWrite = writes.find((w) => w.agent === 'cursor');
      expect(cursorWrite!.planned.output.mode).toBe('write');
    });

    it('resolves append absolute paths to project root', () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot'] as const,
      });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.planned.absolutePath).toBe(join(tmpDir, 'AGENTS.md'));
    });

    it('append mode does not affect native passthrough', () => {
      const items = [nativeRule('lint', 'github-copilot')];
      const opts = baseOptions(tmpDir, { append: true });

      const { writes } = planRuleWrites(items, opts);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.planned.output.mode).toBe('write');
      expect(writes[0]!.planned.output.filename).not.toBe('AGENTS.md');
    });

    it('append mode does not affect prompts or agents', () => {
      const items = [canonicalPrompt('review-code'), canonicalAgent('architect')];
      const opts = baseOptions(tmpDir, { append: true });

      const { writes } = planRuleWrites(items, opts);

      // prompt: 2 agents, agent: 2 agents = 4
      expect(writes).toHaveLength(4);
      for (const w of writes) {
        expect(w.planned.output.mode).toBe('write');
      }
    });
  });

  // -------------------------------------------------------------------------
  // executeInstallPipeline — append mode writes
  // -------------------------------------------------------------------------

  describe('executeInstallPipeline — append mode', () => {
    it('creates AGENTS.md and CLAUDE.md with marker sections', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot', 'claude-code'] as const,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.written).toHaveLength(2);

      const agentsMd = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('<!-- dotai:code-style:start -->');
      expect(agentsMd).toContain('<!-- dotai:code-style:end -->');

      const claudeMd = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
      expect(claudeMd).toContain('<!-- dotai:code-style:start -->');
      expect(claudeMd).toContain('<!-- dotai:code-style:end -->');
    });

    it('preserves existing content in target files', async () => {
      // Pre-create AGENTS.md with user content
      writeFileSync(join(tmpDir, 'AGENTS.md'), '# My Project\n\nCustom instructions here.\n');

      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot'] as const,
        force: true,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Custom instructions here.');
      expect(content).toContain('<!-- dotai:code-style:start -->');
    });

    it('appends multiple rules to the same file', async () => {
      const items = [canonicalRule('code-style'), canonicalRule('security')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot'] as const,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('<!-- dotai:code-style:start -->');
      expect(content).toContain('<!-- dotai:code-style:end -->');
      expect(content).toContain('<!-- dotai:security:start -->');
      expect(content).toContain('<!-- dotai:security:end -->');
    });

    it('updates existing marker section on re-install (idempotent)', async () => {
      // First install
      const items1 = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot'] as const,
      });

      await executeInstallPipeline(items1, opts);
      const content1 = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');

      // Re-install same rule
      const result2 = await executeInstallPipeline(items1, opts);
      expect(result2.success).toBe(true);

      const content2 = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
      // Should have exactly one section, not duplicated
      const startCount = (content2.match(/<!-- dotai:code-style:start -->/g) || []).length;
      expect(startCount).toBe(1);
    });

    it('dry-run does not write append files', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, {
        append: true,
        agents: ['github-copilot'] as const,
        dryRun: true,
      });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      expect(result.writes).toHaveLength(1);
      expect(result.written).toHaveLength(0);
      expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
    });

    it('mixes append and per-rule writes in one pipeline', async () => {
      const items = [canonicalRule('code-style')];
      const opts = baseOptions(tmpDir, { append: true });

      const result = await executeInstallPipeline(items, opts);

      expect(result.success).toBe(true);
      // 5 writes: AGENTS.md, CLAUDE.md, .cursor/rules, .windsurf/rules, .clinerules
      expect(result.written).toHaveLength(5);

      // Append targets
      expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);

      // Per-rule targets
      expect(existsSync(join(tmpDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
      expect(existsSync(join(tmpDir, '.windsurf', 'rules', 'code-style.md'))).toBe(true);
      expect(existsSync(join(tmpDir, '.clinerules', 'code-style.md'))).toBe(true);
    });
  });
});
