import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { runCli } from '../src/test-utils.ts';
import { addRules, addPrompts, addAgents } from '../src/rule-add.ts';
import { writeDotaiLock, createEmptyLock, readDotaiLock } from '../src/dotai-lock.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'restore-test-'));
}

/** Create a canonical RULES.md with standard frontmatter. */
function makeRulesContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
globs:
  - "*.ts"
activation: always
---

${body}
`;
}

/** Create a canonical PROMPT.md with standard frontmatter. */
function makePromptContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

/** Create a canonical AGENT.md with standard frontmatter. */
function makeAgentContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

/** Create a source repo with rules, prompts, and/or agents. */
async function createSourceRepo(
  baseDir: string,
  rules: Array<{ name: string; description: string; body: string }>,
  prompts: Array<{ name: string; description: string; body: string }> = [],
  agents: Array<{ name: string; description: string; body: string }> = []
): Promise<string> {
  const repoDir = join(baseDir, 'source-repo');
  await mkdir(repoDir, { recursive: true });

  // Write rules
  if (rules.length === 1 && prompts.length === 0 && agents.length === 0) {
    await writeFile(
      join(repoDir, 'RULES.md'),
      makeRulesContent(rules[0]!.name, rules[0]!.description, rules[0]!.body)
    );
  } else if (rules.length > 0) {
    const rulesDir = join(repoDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    for (const rule of rules) {
      const ruleDir = join(rulesDir, rule.name);
      await mkdir(ruleDir, { recursive: true });
      await writeFile(
        join(ruleDir, 'RULES.md'),
        makeRulesContent(rule.name, rule.description, rule.body)
      );
    }
  }

  // Write prompts
  if (prompts.length === 1 && rules.length === 0 && agents.length === 0) {
    await writeFile(
      join(repoDir, 'PROMPT.md'),
      makePromptContent(prompts[0]!.name, prompts[0]!.description, prompts[0]!.body)
    );
  } else if (prompts.length > 0) {
    const promptsDir = join(repoDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    for (const prompt of prompts) {
      const promptDir = join(promptsDir, prompt.name);
      await mkdir(promptDir, { recursive: true });
      await writeFile(
        join(promptDir, 'PROMPT.md'),
        makePromptContent(prompt.name, prompt.description, prompt.body)
      );
    }
  }

  // Write agents
  if (agents.length === 1 && rules.length === 0 && prompts.length === 0) {
    await writeFile(
      join(repoDir, 'AGENT.md'),
      makeAgentContent(agents[0]!.name, agents[0]!.description, agents[0]!.body)
    );
  } else if (agents.length > 0) {
    const agentsDir = join(repoDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    for (const agent of agents) {
      const agentDir = join(agentsDir, agent.name);
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        makeAgentContent(agent.name, agent.description, agent.body)
      );
    }
  }

  return repoDir;
}

// ---------------------------------------------------------------------------
// CLI install (no args) → restoreRulesAndPrompts integration tests
// After the routing change, restore is invoked via 'dotai restore' (not 'dotai install')
// ---------------------------------------------------------------------------

describe('dotai restore — restore rules and prompts from .dotai-lock.json', () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('restores rules from .dotai-lock.json via restore command', async () => {
    // Step 1: Create source repo with a rule
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const over let' },
    ]);

    // Step 2: Install the rule first to populate .dotai-lock.json
    const addResult = await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });
    expect(addResult.success).toBe(true);

    // Verify lock file exists
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    // Step 3: Delete the transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.windsurf'), { recursive: true, force: true });
    await rm(join(projectDir, '.clinerules'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore from lock
    const result = runCli(['restore'], projectDir);

    // Should show restore behavior
    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');

    // Transpiled files should be recreated
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(true);
  });

  it('restores prompts from .dotai-lock.json via restore command', async () => {
    // Step 1: Create source repo with a prompt
    const sourceRepo = await createSourceRepo(
      tempDir,
      [],
      [{ name: 'review-code', description: 'Review code for issues', body: 'Review the code.' }]
    );

    // Step 2: Install the prompt first to populate .dotai-lock.json
    const addResult = await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });
    expect(addResult.success).toBe(true);

    // Verify lock file exists
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    // Step 3: Delete transpiled prompt files
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore prompts from lock
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');
  });

  it('restores both rules and prompts from same source', async () => {
    // Create source repo with both rules and prompts
    const sourceRepo = await createSourceRepo(
      tempDir,
      [{ name: 'code-style', description: 'Enforce code style', body: 'Use const' }],
      [{ name: 'review-code', description: 'Review code', body: 'Review the code.' }]
    );

    // Install both
    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });
    await addPrompts({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      promptNames: ['*'],
    });

    // Verify lock file has both
    const { lock } = await readDotaiLock(projectDir);
    expect(lock.items).toHaveLength(2);

    // Delete transpiled files
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.windsurf'), { recursive: true, force: true });
    await rm(join(projectDir, '.clinerules'), { recursive: true, force: true });

    // Restore
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');
    // Should mention both rules and prompts
    expect(result.stdout).toContain('rule');
    expect(result.stdout).toContain('prompt');
  });

  it('shows nothing-found message when both lock files are empty', async () => {
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('No project skills found in skills-lock.json');
  });

  it('shows nothing-found message with empty .dotai-lock.json', async () => {
    // Write an empty dotai lock file
    await writeDotaiLock(createEmptyLock(), projectDir);

    const result = runCli(['restore'], projectDir);

    // Should show the "no project skills" message since both locks are empty
    expect(result.stdout).toContain('No project skills found in skills-lock.json');
  });

  it('handles non-existent source gracefully during restore', async () => {
    // Manually write a .dotai-lock.json with a non-existent local source
    const nonExistentSource = join(tempDir, 'does-not-exist');
    const lock = createEmptyLock();
    lock.items.push({
      type: 'rule',
      name: 'phantom-rule',
      source: nonExistentSource,
      format: 'canonical',
      agents: ['cursor', 'claude-code', 'github-copilot', 'windsurf', 'cline'],
      hash: 'abc123',
      installedAt: '2026-03-01T00:00:00.000Z',
      outputs: [],
    });
    await writeDotaiLock(lock, projectDir);

    // Should not crash — error is caught per-source
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');
    // Should log an error for the failed source but not crash
    expect(result.exitCode).toBe(0);
  });

  it('i alias with no args routes to add (not restore)', async () => {
    // After routing change, 'i' is an alias for 'add', not 'restore'
    const result = runCli(['i'], projectDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('experimental_install restores rules from .dotai-lock.json', async () => {
    // Create source repo and install a rule
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Code style', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Delete transpiled files
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.windsurf'), { recursive: true, force: true });
    await rm(join(projectDir, '.clinerules'), { recursive: true, force: true });

    // Run with experimental_install
    const result = runCli(['experimental_install'], projectDir);

    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');
  });

  it('restores rules with force (overwrites existing files)', async () => {
    // Create source repo and install a rule
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Code style', body: 'Use const' },
    ]);

    await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
    });

    // Modify transpiled file to simulate user edit
    const cursorFile = join(projectDir, '.cursor', 'rules', 'code-style.mdc');
    expect(existsSync(cursorFile)).toBe(true);
    await writeFile(cursorFile, 'user modified content');

    // Restore should overwrite (restore uses force: true)
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');

    // File should be restored to original content
    const restoredContent = await readFile(cursorFile, 'utf-8');
    expect(restoredContent).toContain('Use const');
    expect(restoredContent).not.toBe('user modified content');
  });

  it('restores agents from .dotai-lock.json via restore command', async () => {
    // Step 1: Create source repo with an agent
    const sourceRepo = await createSourceRepo(
      tempDir,
      [],
      [],
      [{ name: 'test-helper', description: 'A test helper agent', body: 'Help with testing.' }]
    );

    // Step 2: Install the agent first to populate .dotai-lock.json
    const addResult = await addAgents({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      agentNames: ['*'],
      force: true,
    });
    expect(addResult.success).toBe(true);

    // Verify lock file exists and has agent entry
    const { lock } = await readDotaiLock(projectDir);
    const agentEntries = lock.items.filter((e) => e.type === 'agent');
    expect(agentEntries.length).toBe(1);

    // Step 3: Delete transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });
    await rm(join(projectDir, '.claude'), { recursive: true, force: true });
    await rm(join(projectDir, '.github'), { recursive: true, force: true });
    await rm(join(projectDir, '.windsurf'), { recursive: true, force: true });
    await rm(join(projectDir, '.clinerules'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore agents from lock
    const result = runCli(['restore'], projectDir);

    // Should show restore behavior
    expect(result.stdout).toContain('Restoring');
    expect(result.stdout).toContain('.dotai-lock.json');
    expect(result.stdout).toContain('agent');
  });

  it('restores append-mode rules with markers instead of per-file outputs', async () => {
    // Step 1: Create source repo with a rule
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const over let' },
    ]);

    // Step 2: Install the rule with --append to populate .dotai-lock.json
    const addResult = await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      append: true,
    });
    expect(addResult.success).toBe(true);

    // Verify lock entry has append: true
    const { lock } = await readDotaiLock(projectDir);
    const ruleEntry = lock.items.find((e) => e.type === 'rule');
    expect(ruleEntry?.append).toBe(true);

    // Step 3: Delete all transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });
    await rm(join(projectDir, '.windsurf'), { recursive: true, force: true });
    await rm(join(projectDir, '.clinerules'), { recursive: true, force: true });
    // Append-mode outputs
    const agentsMdExists = existsSync(join(projectDir, 'AGENTS.md'));
    if (agentsMdExists) await rm(join(projectDir, 'AGENTS.md'));
    const claudeMdExists = existsSync(join(projectDir, 'CLAUDE.md'));
    if (claudeMdExists) await rm(join(projectDir, 'CLAUDE.md'));

    // Step 4: Run dotai restore — should restore with append mode
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');

    // Append-mode outputs should be recreated with markers
    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- dotai:code-style:start -->');
    expect(agentsMd).toContain('<!-- dotai:code-style:end -->');
    expect(agentsMd).toContain('Use const over let');

    const claudeMd = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('<!-- dotai:code-style:start -->');
    expect(claudeMd).toContain('<!-- dotai:code-style:end -->');
    expect(claudeMd).toContain('Use const over let');

    // Per-file outputs should NOT exist for copilot/claude (append mode)
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(false);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(false);

    // Per-file outputs should still exist for cursor, windsurf, cline
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
  });

  it('restores rules only to agents listed in lock entry', async () => {
    // Step 1: Create source repo with a rule
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const over let' },
    ]);

    // Step 2: Install the rule for cursor only
    const addResult = await addRules({
      source: sourceRepo,
      sourcePath: sourceRepo,
      projectRoot: projectDir,
      ruleNames: ['*'],
      targets: ['cursor'],
    });
    expect(addResult.success).toBe(true);

    // Verify lock entry has agents: ['cursor'] only
    const { lock } = await readDotaiLock(projectDir);
    const ruleEntry = lock.items.find((e) => e.type === 'rule');
    expect(ruleEntry?.agents).toEqual(['cursor']);

    // Step 3: Delete transpiled files (simulate fresh checkout)
    await rm(join(projectDir, '.cursor'), { recursive: true, force: true });

    // Step 4: Run dotai restore — should restore only to cursor
    const result = runCli(['restore'], projectDir);

    expect(result.stdout).toContain('Restoring');

    // Cursor files should be recreated
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);

    // Other agents should NOT have files
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(false);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.windsurf', 'rules', 'code-style.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.clinerules', 'code-style.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routing edge cases (supplement to existing tests in add.test.ts)
// ---------------------------------------------------------------------------

describe('install routing edge cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('install with flags but no positional args routes to add (not restore)', () => {
    // After routing change, 'install' always routes to 'add'
    const result = runCli(['install', '-y'], tempDir);

    // Should show add behavior (error because no source)
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('i with --global flag and no args routes to add (not restore)', () => {
    const result = runCli(['i', '-g'], tempDir);

    // Should show add behavior (error because no source)
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('add with no args still shows error (not restore)', () => {
    const result = runCli(['add'], tempDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('a with no args still shows error (not restore)', () => {
    const result = runCli(['a'], tempDir);

    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });
});
