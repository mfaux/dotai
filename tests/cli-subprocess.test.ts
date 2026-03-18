import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runCli } from '../src/test-utils.ts';
import {
  createTempProjectDir,
  makeSimpleRulesContent,
  makeSimpleAgentContent,
  createTestSourceRepo,
  readLockFileFromDisk,
} from './e2e-utils.ts';

// ---------------------------------------------------------------------------
// CLI subprocess tests for --rule flag
// ---------------------------------------------------------------------------

describe('CLI --rule subprocess tests', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --rule installs rule and creates lock file', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const over let' },
    ]);

    const result = runCli(['add', sourceRepo, '--rule', 'code-style', '-y'], projectDir);

    // Should succeed (exit code 0)
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rule(s) installed');

    // Verify lock file was created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    const lock = await readLockFileFromDisk(projectDir);
    expect(lock.items).toHaveLength(1);
    expect(lock.items[0]!.name).toBe('code-style');
    expect(lock.items[0]!.type).toBe('rule');

    // Verify transpiled files exist
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(true);
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(true);
    expect(existsSync(join(projectDir, '.windsurf', 'rules', 'code-style.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.clinerules', 'code-style.md'))).toBe(true);
  });

  it('add --rule --dry-run does not create files', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    const result = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--dry-run', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry');

    // No lock file or transpiled files
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.cursor'))).toBe(false);
  });

  it('add --rule --targets limits target agents', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style rules', body: 'Use const' },
    ]);

    const result = runCli(
      ['add', sourceRepo, '--rule', 'code-style', '--targets', 'cursor,cline', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);

    // Only cursor and cline should have files
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.clinerules', 'code-style.md'))).toBe(true);

    // Other agents should not
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(false);
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(false);
    expect(existsSync(join(projectDir, '.windsurf', 'rules', 'code-style.md'))).toBe(false);

    // Lock file should only list targeted agents
    const lock = await readLockFileFromDisk(projectDir);
    const agents = lock.items[0]!.agents;
    expect(agents).toHaveLength(2);
    expect(agents).toContain('cursor');
    expect(agents).toContain('cline');
  });

  it('add --rule --force overrides existing file', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    // Create pre-existing user file
    const cursorDir = join(projectDir, '.cursor', 'rules');
    await mkdir(cursorDir, { recursive: true });
    await writeFile(join(cursorDir, 'code-style.mdc'), 'user content');

    const result = runCli(['add', sourceRepo, '--rule', 'code-style', '--force', '-y'], projectDir);

    expect(result.exitCode).toBe(0);

    // File should be overwritten
    const content = await readFile(join(cursorDir, 'code-style.mdc'), 'utf-8');
    expect(content).toContain('Use const');
    expect(content).not.toBe('user content');

    // Lock file should exist
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);
  });

  it('add --rule with nonexistent rule name reports error', async () => {
    const sourceRepo = await createTestSourceRepo(tempDir, [
      { name: 'code-style', description: 'Style', body: 'Use const' },
    ]);

    const result = runCli(['add', sourceRepo, '--rule', 'nonexistent', '-y'], projectDir);

    // Should fail
    expect(result.exitCode).toBe(0); // CLI doesn't exit(1) on rule-not-found, it reports the error
    expect(result.stdout).toContain('No matching rules');

    // No lock file should be created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess tests for --custom-agent flag
// ---------------------------------------------------------------------------

describe('CLI --custom-agent subprocess tests', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --custom-agent installs agent and creates lock file', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'architect', description: 'System design agent', body: 'You are an architect.' }],
      'agent'
    );

    const result = runCli(['add', sourceRepo, '--custom-agent', 'architect', '-y'], projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('agent(s) installed');

    // Verify lock file was created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(true);

    const lock = await readLockFileFromDisk(projectDir);
    const agentEntries = lock.items.filter((i) => i.type === 'agent');
    expect(agentEntries).toHaveLength(1);
    expect(agentEntries[0]!.name).toBe('architect');
    expect(agentEntries[0]!.type).toBe('agent');

    // Verify transpiled files exist for Copilot and Claude Code only
    expect(existsSync(join(projectDir, '.github', 'agents', 'architect.agent.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'agents', 'architect.md'))).toBe(true);

    // No agent files for Cursor, Windsurf, Cline (no agent support)
    expect(existsSync(join(projectDir, '.cursor', 'agents'))).toBe(false);
    expect(existsSync(join(projectDir, '.windsurf', 'agents'))).toBe(false);
    expect(existsSync(join(projectDir, '.clinerules'))).toBe(false);
  });

  it('add --custom-agent --dry-run does not create files', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'architect', description: 'System design agent', body: 'You are an architect.' }],
      'agent'
    );

    const result = runCli(
      ['add', sourceRepo, '--custom-agent', 'architect', '--dry-run', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry');

    // No lock file or transpiled files
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.github'))).toBe(false);
  });

  it('add --custom-agent --targets limits target agents', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'architect', description: 'System design agent', body: 'You are an architect.' }],
      'agent'
    );

    const result = runCli(
      ['add', sourceRepo, '--custom-agent', 'architect', '--targets', 'copilot', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);

    // Only Copilot should have the agent file
    expect(existsSync(join(projectDir, '.github', 'agents', 'architect.agent.md'))).toBe(true);

    // Claude Code should not
    expect(existsSync(join(projectDir, '.claude', 'agents', 'architect.md'))).toBe(false);
  });

  it('add --custom-agent with nonexistent agent name reports error', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [{ name: 'architect', description: 'System design agent', body: 'You are an architect.' }],
      'agent'
    );

    const result = runCli(['add', sourceRepo, '--custom-agent', 'nonexistent', '-y'], projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No matching agents');

    // No lock file should be created
    expect(existsSync(join(projectDir, '.dotai-lock.json'))).toBe(false);
  });

  it('add --custom-agent with wildcard installs all agents', async () => {
    const sourceRepo = await createTestSourceRepo(
      tempDir,
      [
        { name: 'architect', description: 'System design', body: 'You are an architect.' },
        { name: 'reviewer', description: 'Code reviewer', body: 'You review code.' },
      ],
      'agent'
    );

    const result = runCli(['add', sourceRepo, '--custom-agent', '*', '-y'], projectDir);

    expect(result.exitCode).toBe(0);

    const lock = await readLockFileFromDisk(projectDir);
    const agentEntries = lock.items.filter((i) => i.type === 'agent');
    expect(agentEntries).toHaveLength(2);
    const names = agentEntries.map((e) => e.name).sort();
    expect(names).toEqual(['architect', 'reviewer']);
  });

  it('add --custom-agent alongside --rule installs both', async () => {
    // Create a source repo with both a rule and an agent
    const repoDir = join(tempDir, 'mixed-source');
    await mkdir(repoDir, { recursive: true });

    // Add a rule at root
    await writeFile(
      join(repoDir, 'RULES.md'),
      makeSimpleRulesContent('code-style', 'Style rules', 'Use const over let')
    );

    // Add an agent in agents/ directory
    const agentsDir = join(repoDir, 'agents', 'architect');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, 'AGENT.md'),
      makeSimpleAgentContent('architect', 'System design agent', 'You are an architect.')
    );

    const result = runCli(
      ['add', repoDir, '--rule', 'code-style', '--custom-agent', 'architect', '-y'],
      projectDir
    );

    expect(result.exitCode).toBe(0);

    const lock = await readLockFileFromDisk(projectDir);
    const ruleEntries = lock.items.filter((i) => i.type === 'rule');
    const agentEntries = lock.items.filter((i) => i.type === 'agent');
    expect(ruleEntries).toHaveLength(1);
    expect(agentEntries).toHaveLength(1);
    expect(ruleEntries[0]!.name).toBe('code-style');
    expect(agentEntries[0]!.name).toBe('architect');
  });
});

// ---------------------------------------------------------------------------
// CLI skill subprocess tests
// ---------------------------------------------------------------------------

describe('CLI skill subprocess tests', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --dry-run does not install skills or write local lock files', async () => {
    const sourceRepo = join(tempDir, 'skill-source-repo');
    await mkdir(sourceRepo, { recursive: true });
    await writeFile(
      join(sourceRepo, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    const result = runCli(
      ['add', sourceRepo, '--dry-run', '-y', '--agent', 'claude-code'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry run');
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(join(projectDir, '.agents'))).toBe(false);
    expect(existsSync(join(projectDir, 'skills-lock.json'))).toBe(false);
  });
});
