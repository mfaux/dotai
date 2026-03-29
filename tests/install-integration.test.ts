import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discover } from '../src/rule-discovery.ts';
import { executeInstallPipeline } from '../src/rule-installer.ts';
import type { LockEntry, TargetAgent } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Integration tests for the full install flow:
//   discover → transpile → check collisions → install
//
// These tests create realistic source repo directory structures on disk,
// run the discovery engine over them, then feed discovered items through
// the install pipeline into a separate project directory.
//
// Reference: PRD.md Phase 5 — "Integration tests for install + rollback +
// collision handling"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All four target agents. */
const ALL_AGENTS: readonly TargetAgent[] = [
  'github-copilot',
  'claude-code',
  'cursor',
  'opencode',
] as const;

/** Create a canonical RULES.md file with valid frontmatter. */
function writeRulesMd(
  dir: string,
  name: string,
  opts: {
    description?: string;
    activation?: string;
    globs?: string[];
    body?: string;
  } = {}
): void {
  const desc = opts.description ?? `Description for ${name}`;
  const activation = opts.activation ?? 'always';
  const body = opts.body ?? `## ${name}\n\nRule body for ${name}.`;

  const globLines =
    opts.globs && opts.globs.length > 0
      ? `globs:\n${opts.globs.map((g) => `  - "${g}"`).join('\n')}\n`
      : '';

  const content = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    `activation: ${activation}`,
    globLines ? globLines.trimEnd() : null,
    '---',
    '',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n');

  writeFileSync(join(dir, 'RULES.md'), content);
}

/** Create a canonical SKILL.md file with valid frontmatter. */
function writeSkillMd(dir: string, name: string, description?: string): void {
  const desc = description ?? `Skill description for ${name}`;
  const content = `---\nname: ${name}\ndescription: ${desc}\n---\n\nSkill body for ${name}.\n`;
  writeFileSync(join(dir, 'SKILL.md'), content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration: discover → transpile → install', () => {
  let sourceDir: string;
  let projectDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), 'dotai-integ-source-'));
    projectDir = mkdtempSync(join(tmpdir(), 'dotai-integ-project-'));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path: single rule → all 4 agents
  // -------------------------------------------------------------------------

  it('discovers and installs a single canonical rule to all 4 agents', async () => {
    // Source repo has one canonical rule
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style', {
      activation: 'always',
      body: '- Use const over let',
    });

    // Discover
    const { items, warnings } = await discover(sourceDir);
    const rules = items.filter((i) => i.type === 'rule');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe('code-style');
    expect(rules[0]!.format).toBe('canonical');

    // Install
    const result = await executeInstallPipeline(rules, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(4);
    expect(result.collisions).toHaveLength(0);

    // Verify each agent got the file
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.opencode', 'rules', 'code-style.md'))).toBe(true);

    // Verify content is correctly transpiled
    const cursorContent = readFileSync(
      join(projectDir, '.cursor', 'rules', 'code-style.mdc'),
      'utf-8'
    );
    expect(cursorContent).toContain('alwaysApply: true');
    expect(cursorContent).toContain('- Use const over let');

    const copilotContent = readFileSync(
      join(projectDir, '.github', 'instructions', 'code-style.instructions.md'),
      'utf-8'
    );
    expect(copilotContent).toContain('applyTo: "**"');

    const claudeContent = readFileSync(
      join(projectDir, '.claude', 'rules', 'code-style.md'),
      'utf-8'
    );
    expect(claudeContent).toContain('description: "Description for code-style"');
  });

  // -------------------------------------------------------------------------
  // Multiple rules from subdirectories
  // -------------------------------------------------------------------------

  it('discovers and installs multiple rules from rules/ subdirectories', async () => {
    // Create two rules
    const rule1Dir = join(sourceDir, 'rules', 'code-style');
    const rule2Dir = join(sourceDir, 'rules', 'security');
    mkdirSync(rule1Dir, { recursive: true });
    mkdirSync(rule2Dir, { recursive: true });
    writeRulesMd(rule1Dir, 'code-style');
    writeRulesMd(rule2Dir, 'security', { activation: 'auto' });

    const { items } = await discover(sourceDir);
    const rules = items.filter((i) => i.type === 'rule');
    expect(rules).toHaveLength(2);

    const result = await executeInstallPipeline(rules, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(2);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'security.mdc'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Root RULES.md + subdirectory rules
  // -------------------------------------------------------------------------

  it('discovers root RULES.md alongside subdirectory rules', async () => {
    writeRulesMd(sourceDir, 'root-rule', { body: 'Root rule body' });
    const subDir = join(sourceDir, 'rules', 'sub-rule');
    mkdirSync(subDir, { recursive: true });
    writeRulesMd(subDir, 'sub-rule');

    const { items } = await discover(sourceDir);
    const rules = items.filter((i) => i.type === 'rule');
    expect(rules).toHaveLength(2);

    const names = rules.map((r) => r.name).sort();
    expect(names).toEqual(['root-rule', 'sub-rule']);
  });

  // -------------------------------------------------------------------------
  // Mixed discovery: rules + skills
  // -------------------------------------------------------------------------

  it('discovers both rules and skills; pipeline installs rules and skips skills', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    const skillDir = join(sourceDir, 'skills', 'db-migrate');
    mkdirSync(skillDir, { recursive: true });
    writeSkillMd(skillDir, 'db-migrate');

    const { items } = await discover(sourceDir);
    expect(items.filter((i) => i.type === 'rule')).toHaveLength(1);
    expect(items.filter((i) => i.type === 'skill')).toHaveLength(1);

    // Install all items — pipeline should skip skills silently
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(1); // only the rule
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Native passthrough rules
  // -------------------------------------------------------------------------

  it('discovers native cursor rules and installs via passthrough', async () => {
    const nativeDir = join(sourceDir, '.cursor', 'rules');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(
      join(nativeDir, 'lint-config.mdc'),
      '---\ndescription: Lint config\nalwaysApply: true\n---\nLint body'
    );

    const { items } = await discover(sourceDir);
    const nativeRules = items.filter((i) => i.format === 'native:cursor');
    expect(nativeRules).toHaveLength(1);
    expect(nativeRules[0]!.name).toBe('lint-config');

    const result = await executeInstallPipeline(nativeRules, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(1);

    const content = readFileSync(join(projectDir, '.cursor', 'rules', 'lint-config.mdc'), 'utf-8');
    // Native passthrough preserves content exactly
    expect(content).toContain('Lint body');
    expect(content).toContain('alwaysApply: true');
  });

  // -------------------------------------------------------------------------
  // Mixed canonical + native in one pass
  // -------------------------------------------------------------------------

  it('installs canonical + native rules from same source repo', async () => {
    // Canonical rule
    const canonDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(canonDir, { recursive: true });
    writeRulesMd(canonDir, 'code-style');

    // Native cursor rule
    const nativeDir = join(sourceDir, '.cursor', 'rules');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'native-lint.mdc'), 'Native cursor lint content');

    const { items } = await discover(sourceDir);

    // Install only to cursor — both canonical and native should work
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });

    expect(result.success).toBe(true);
    // 1 canonical rule → 1 cursor output + 1 native cursor passthrough
    expect(result.written).toHaveLength(2);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'native-lint.mdc'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Glob activation: correct mapping across agents
  // -------------------------------------------------------------------------

  it('transpiles glob activation correctly for all agents', async () => {
    const ruleDir = join(sourceDir, 'rules', 'ts-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'ts-style', {
      activation: 'glob',
      globs: ['*.ts', '*.tsx'],
      body: 'TypeScript style rules',
    });

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(4);

    // Cursor: globs as comma-separated string
    const cursor = readFileSync(join(projectDir, '.cursor', 'rules', 'ts-style.mdc'), 'utf-8');
    expect(cursor).toContain('globs: *.ts, *.tsx');
    expect(cursor).toContain('alwaysApply: false');

    // Copilot: applyTo with globs
    const copilot = readFileSync(
      join(projectDir, '.github', 'instructions', 'ts-style.instructions.md'),
      'utf-8'
    );
    expect(copilot).toContain('applyTo:');
    expect(copilot).toContain('*.ts');
  });

  // -------------------------------------------------------------------------
  // Dry-run mode
  // -------------------------------------------------------------------------

  it('dry-run reports planned writes without creating any files', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.writes).toHaveLength(4);
    expect(result.written).toHaveLength(0);

    // No files should have been created
    expect(existsSync(join(projectDir, '.cursor'))).toBe(false);
    expect(existsSync(join(projectDir, '.github'))).toBe(false);
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(join(projectDir, '.opencode'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Agent subset filtering
  // -------------------------------------------------------------------------

  it('installs only to specified agents, others untouched', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor', 'opencode'] as const,
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(2);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.opencode', 'rules', 'code-style.md'))).toBe(true);

    // Others should NOT exist
    expect(existsSync(join(projectDir, '.github'))).toBe(false);
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Collision: pre-existing user file blocks install
  // -------------------------------------------------------------------------

  it('blocks install when user file already exists at target path', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    // Pre-existing user file in the project
    const conflictDir = join(projectDir, '.cursor', 'rules');
    mkdirSync(conflictDir, { recursive: true });
    writeFileSync(join(conflictDir, 'code-style.mdc'), 'user-authored content');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(false);
    expect(result.collisions.length).toBeGreaterThan(0);
    expect(result.collisions[0]!.kind).toBe('file-exists');
    expect(result.written).toHaveLength(0);

    // User file should be untouched
    const content = readFileSync(join(conflictDir, 'code-style.mdc'), 'utf-8');
    expect(content).toBe('user-authored content');
  });

  // -------------------------------------------------------------------------
  // Collision: --force overrides pre-existing file
  // -------------------------------------------------------------------------

  it('--force overrides pre-existing user files and completes install', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    // Pre-existing user file
    const conflictDir = join(projectDir, '.cursor', 'rules');
    mkdirSync(conflictDir, { recursive: true });
    writeFileSync(join(conflictDir, 'code-style.mdc'), 'user-authored content');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      force: true,
    });

    expect(result.success).toBe(true);
    expect(result.collisions.length).toBeGreaterThan(0); // collisions detected but forced
    expect(result.written).toHaveLength(4);

    // File should now have transpiled content, not user content
    const content = readFileSync(join(conflictDir, 'code-style.mdc'), 'utf-8');
    expect(content).not.toBe('user-authored content');
    expect(content).toContain('alwaysApply:');
  });

  // -------------------------------------------------------------------------
  // Collision: same-name from different source
  // -------------------------------------------------------------------------

  it('blocks when same rule name is already installed from a different source', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    const existingEntry: LockEntry = {
      type: 'rule',
      name: 'code-style',
      source: 'other/repo',
      format: 'canonical',
      agents: ['cursor'],
      hash: 'abc123',
      installedAt: new Date().toISOString(),
      outputs: [join(projectDir, '.cursor', 'rules', 'code-style.mdc')],
    };

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [existingEntry],
    });

    expect(result.success).toBe(false);
    expect(result.collisions.some((c) => c.kind === 'same-name')).toBe(true);
    expect(result.written).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Update path: re-install from same source succeeds
  // -------------------------------------------------------------------------

  it('allows re-install from same source (update path)', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style', { body: 'Updated rule body' });

    const existingEntry: LockEntry = {
      type: 'rule',
      name: 'code-style',
      source: 'test/repo', // same source
      format: 'canonical',
      agents: ['cursor'],
      hash: 'old-hash',
      installedAt: new Date().toISOString(),
      outputs: [join(projectDir, '.cursor', 'rules', 'code-style.mdc')],
    };

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [existingEntry],
      targets: ['cursor'] as const,
    });

    expect(result.success).toBe(true);
    expect(result.collisions).toHaveLength(0);
    expect(result.written).toHaveLength(1);

    const content = readFileSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'), 'utf-8');
    expect(content).toContain('Updated rule body');
  });

  // -------------------------------------------------------------------------
  // Rollback: write failure cleans up partial files
  // -------------------------------------------------------------------------

  it('rolls back written files when a subsequent write fails', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style');

    // Block one agent directory by creating a file where a directory is expected
    // This causes mkdir to fail when the pipeline tries to create subdirectories
    writeFileSync(join(projectDir, '.opencode'), 'blocker-file');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.written).toHaveLength(0);

    // Files that were written before the failure should be rolled back
    // Cursor is alphabetically before opencode in the output order, so
    // it may have been written first — verify cleanup happened
    const cursorFile = join(projectDir, '.cursor', 'rules', 'code-style.mdc');
    const copilotFile = join(projectDir, '.github', 'instructions', 'code-style.instructions.md');
    const claudeFile = join(projectDir, '.claude', 'rules', 'code-style.md');

    // After rollback, none of the successfully-written files should remain
    // (the pipeline deletes them on failure)
    const remainingFiles = [cursorFile, copilotFile, claudeFile].filter((f) => existsSync(f));
    expect(remainingFiles).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // No items: empty discovery produces no writes
  // -------------------------------------------------------------------------

  it('handles empty source repo gracefully', async () => {
    // sourceDir has no rules or skills
    const { items } = await discover(sourceDir);
    expect(items).toHaveLength(0);

    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(true);
    expect(result.writes).toHaveLength(0);
    expect(result.written).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Invalid rule: discovery warns, pipeline skips
  // -------------------------------------------------------------------------

  it('discovery warns on invalid rules; pipeline skips them', async () => {
    // Valid rule
    const validDir = join(sourceDir, 'rules', 'good-rule');
    mkdirSync(validDir, { recursive: true });
    writeRulesMd(validDir, 'good-rule');

    // Invalid rule (missing required fields)
    const invalidDir = join(sourceDir, 'rules', 'bad-rule');
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(join(invalidDir, 'RULES.md'), '---\n---\nNo frontmatter');

    const { items, warnings } = await discover(sourceDir);
    expect(items.filter((i) => i.type === 'rule')).toHaveLength(1);
    expect(warnings.some((w) => w.type === 'parse-error')).toBe(true);

    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });

    expect(result.success).toBe(true);
    expect(result.written).toHaveLength(1);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'good-rule.mdc'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Collision: canonical-native in same batch
  // -------------------------------------------------------------------------

  it('detects canonical-native collision when both target same path', async () => {
    // Canonical rule named "lint"
    const canonDir = join(sourceDir, 'rules', 'lint');
    mkdirSync(canonDir, { recursive: true });
    writeRulesMd(canonDir, 'lint');

    // Native cursor rule also named "lint" (will produce same output path)
    const nativeDir = join(sourceDir, '.cursor', 'rules');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'lint.mdc'), 'Native lint content');

    const { items } = await discover(sourceDir);
    const canonicalRules = items.filter((i) => i.format === 'canonical' && i.type === 'rule');
    const nativeRules = items.filter((i) => i.format === 'native:cursor');
    expect(canonicalRules).toHaveLength(1);
    expect(nativeRules).toHaveLength(1);

    // Install both to cursor — should detect canonical-native collision
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });

    // One of them should collide
    expect(result.collisions.some((c) => c.kind === 'canonical-native')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Idempotent re-install: overwrite existing transpiled output
  // -------------------------------------------------------------------------

  it('re-install updates existing transpiled files from same source', async () => {
    const ruleDir = join(sourceDir, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeRulesMd(ruleDir, 'code-style', { body: 'Original body' });

    // First install
    const { items: items1 } = await discover(sourceDir);
    const result1 = await executeInstallPipeline(items1, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
      targets: ['cursor'] as const,
    });
    expect(result1.success).toBe(true);

    const outputPath = join(projectDir, '.cursor', 'rules', 'code-style.mdc');
    const firstContent = readFileSync(outputPath, 'utf-8');
    expect(firstContent).toContain('Original body');

    // Build lock entry from first install
    const lockEntry: LockEntry = {
      type: 'rule',
      name: 'code-style',
      source: 'test/repo',
      format: 'canonical',
      agents: ['cursor'],
      hash: 'first-hash',
      installedAt: new Date().toISOString(),
      outputs: [outputPath],
    };

    // Update source content
    writeRulesMd(ruleDir, 'code-style', { body: 'Updated body' });

    // Second install (update)
    const { items: items2 } = await discover(sourceDir);
    const result2 = await executeInstallPipeline(items2, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [lockEntry],
      targets: ['cursor'] as const,
    });
    expect(result2.success).toBe(true);
    expect(result2.collisions).toHaveLength(0);

    const updatedContent = readFileSync(outputPath, 'utf-8');
    expect(updatedContent).toContain('Updated body');
    expect(updatedContent).not.toContain('Original body');
  });

  // -------------------------------------------------------------------------
  // Multi-rule collision: one rule collides, entire batch blocked
  // -------------------------------------------------------------------------

  it('blocks entire batch when one rule has a collision', async () => {
    const rule1Dir = join(sourceDir, 'rules', 'rule-a');
    const rule2Dir = join(sourceDir, 'rules', 'rule-b');
    mkdirSync(rule1Dir, { recursive: true });
    mkdirSync(rule2Dir, { recursive: true });
    writeRulesMd(rule1Dir, 'rule-a');
    writeRulesMd(rule2Dir, 'rule-b');

    // Pre-existing file for rule-a only
    const conflictDir = join(projectDir, '.cursor', 'rules');
    mkdirSync(conflictDir, { recursive: true });
    writeFileSync(join(conflictDir, 'rule-a.mdc'), 'user content');

    const { items } = await discover(sourceDir);
    const result = await executeInstallPipeline(items, {
      projectRoot: projectDir,
      source: 'test/repo',
      lockEntries: [],
    });

    expect(result.success).toBe(false);
    expect(result.written).toHaveLength(0);

    // Neither rule should have been written
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'rule-b.mdc'))).toBe(false);
    expect(existsSync(join(projectDir, '.opencode', 'rules', 'rule-b.md'))).toBe(false);
  });
});
