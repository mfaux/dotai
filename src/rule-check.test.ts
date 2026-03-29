import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkRuleUpdates, updateRules } from './rule-check.ts';
import {
  writeDotaiLock,
  createEmptyLock,
  upsertLockEntry,
  computeContentHash,
} from './dotai-lock.ts';
import type { DotaiLockFile } from './dotai-lock.ts';
import type { LockEntry, TargetAgent } from './types.ts';
import { existsSync, readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory for tests. */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rule-check-test-'));
}

/** Create a canonical RULES.md file with standard frontmatter. */
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

/** Create a source repo directory structure with canonical rules. */
async function createSourceRepo(
  tempDir: string,
  rules: Array<{ name: string; description: string; body: string }>
): Promise<string> {
  const repoDir = join(tempDir, 'source-repo');
  await mkdir(repoDir, { recursive: true });

  if (rules.length === 1) {
    // Single rule at root
    const rule = rules[0]!;
    await writeFile(
      join(repoDir, 'RULES.md'),
      makeRulesContent(rule.name, rule.description, rule.body)
    );
  } else {
    // Multiple rules in rules/ subdirectories
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

  return repoDir;
}

/** Create a lock entry for a rule. */
function makeLockEntry(
  name: string,
  source: string,
  rawContent: string,
  agents: TargetAgent[] = ['github-copilot', 'claude-code', 'cursor', 'opencode']
): LockEntry {
  return {
    type: 'rule',
    name,
    source,
    format: 'canonical',
    agents,
    hash: computeContentHash(rawContent),
    installedAt: '2026-02-28T00:00:00.000Z',
    outputs: agents.map((a) => `/project/.${a}/rules/${name}.md`),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkRuleUpdates', () => {
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

  it('returns empty result when no rules in lock file', async () => {
    await writeDotaiLock(createEmptyLock(), projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(0);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty result when lock file does not exist', async () => {
    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(0);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects no updates when content is unchanged', async () => {
    const content = makeRulesContent('code-style', 'Enforce code style', 'Use const over let');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const over let' },
    ]);

    // Write lock file with matching hash
    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects update when content has changed', async () => {
    const originalContent = makeRulesContent(
      'code-style',
      'Enforce code style',
      'Use const over let'
    );
    // Source has updated content
    await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Updated: Use const always' },
    ]);

    let lock = createEmptyLock();
    const sourceRepo = join(tempDir, 'source-repo');
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, originalContent));
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('code-style');
    expect(result.updates[0]!.currentHash).toBe(computeContentHash(originalContent));
    expect(result.updates[0]!.latestHash).not.toBe(result.updates[0]!.currentHash);
  });

  it('reports error when source repo does not exist', async () => {
    const content = makeRulesContent('code-style', 'Enforce code style', 'body');
    const nonExistentPath = join(tempDir, 'does-not-exist');

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', nonExistentPath, content));
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    // Rule is no longer found in the (empty) source
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.entry.name).toBe('code-style');
  });

  it('reports error when rule is no longer in source', async () => {
    const content = makeRulesContent('old-rule', 'Old rule', 'old body');
    // Source repo has a different rule
    await createSourceRepo(tempDir, [
      { name: 'new-rule', description: 'New rule', body: 'new body' },
    ]);

    let lock = createEmptyLock();
    const sourceRepo = join(tempDir, 'source-repo');
    lock = upsertLockEntry(lock, makeLockEntry('old-rule', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('no longer found');
  });

  it('handles multiple rules from same source', async () => {
    const content1 = makeRulesContent('rule-a', 'Rule A', 'body a');
    const content2 = makeRulesContent('rule-b', 'Rule B', 'body b');

    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'rule-a', description: 'Rule A', body: 'body a' },
      { name: 'rule-b', description: 'Rule B', body: 'body b CHANGED' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('rule-a', sourceRepo, content1));
    lock = upsertLockEntry(lock, makeLockEntry('rule-b', sourceRepo, content2));
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(2);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('rule-b');
    expect(result.errors).toHaveLength(0);
  });

  it('only checks rule entries (not skills)', async () => {
    let lock = createEmptyLock();
    const skillEntry: LockEntry = {
      type: 'skill',
      name: 'my-skill',
      source: join(tempDir, 'source-repo'),
      format: 'canonical',
      agents: ['github-copilot'],
      hash: 'abc123',
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [],
    };
    lock = upsertLockEntry(lock, skillEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(0);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('checks prompt entries alongside rules', async () => {
    const ruleContent = makeRulesContent('code-style', 'Enforce code style', 'Use const');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const' },
    ]);

    // Create a prompt in the same source repo
    const promptContent = `---
name: review-code
description: Review code for issues
---

Review the code for bugs.
`;
    const promptDir = join(sourceRepo, 'prompts', 'review-code');
    await mkdir(promptDir, { recursive: true });
    await writeFile(join(promptDir, 'PROMPT.md'), promptContent);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, ruleContent));

    const promptEntry: LockEntry = {
      type: 'prompt',
      name: 'review-code',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(promptContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: ['/project/.github/prompts/review-code.prompt.md'],
    };
    lock = upsertLockEntry(lock, promptEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    // Should check both the rule and the prompt
    expect(result.totalChecked).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('detects prompt update when content has changed', async () => {
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    // Source has updated prompt content
    const updatedPromptContent = `---
name: review-code
description: Review code for issues
---

Review the code for bugs and security issues.
`;
    await writeFile(join(sourceRepo, 'PROMPT.md'), updatedPromptContent);

    const originalPromptContent = `---
name: review-code
description: Review code for issues
---

Review the code for bugs.
`;

    let lock = createEmptyLock();
    const promptEntry: LockEntry = {
      type: 'prompt',
      name: 'review-code',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(originalPromptContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: ['/project/.github/prompts/review-code.prompt.md'],
    };
    lock = upsertLockEntry(lock, promptEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('review-code');
    expect(result.updates[0]!.entry.type).toBe('prompt');
  });

  it('checks agent entries alongside rules and prompts', async () => {
    const ruleContent = makeRulesContent('code-style', 'Enforce code style', 'Use const');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const' },
    ]);

    // Create an agent in the same source repo
    const agentContent = `---
name: architect
description: Senior architect for code review
---

You are a senior software architect.
`;
    const agentDir = join(sourceRepo, 'agents', 'architect');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'AGENT.md'), agentContent);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, ruleContent));

    const agentEntry: LockEntry = {
      type: 'agent',
      name: 'architect',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(agentContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [join(projectDir, '.github', 'agents', 'architect.agent.md')],
    };
    lock = upsertLockEntry(lock, agentEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    // Should check both the rule and the agent
    expect(result.totalChecked).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('detects agent update when content has changed', async () => {
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    // Source has updated agent content
    const updatedAgentContent = `---
name: architect
description: Senior architect for code review
---

You are a senior software architect. Focus on security.
`;
    await writeFile(join(sourceRepo, 'AGENT.md'), updatedAgentContent);

    const originalAgentContent = `---
name: architect
description: Senior architect for code review
---

You are a senior software architect.
`;

    let lock = createEmptyLock();
    const agentEntry: LockEntry = {
      type: 'agent',
      name: 'architect',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(originalAgentContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [join(projectDir, '.github', 'agents', 'architect.agent.md')],
    };
    lock = upsertLockEntry(lock, agentEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('architect');
    expect(result.updates[0]!.entry.type).toBe('agent');
  });

  it('reports error when agent is no longer in source', async () => {
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    // Source has a different agent, not the one in lock
    const differentAgent = `---
name: reviewer
description: Code reviewer
---

Review code.
`;
    await writeFile(join(sourceRepo, 'AGENT.md'), differentAgent);

    const originalAgent = `---
name: architect
description: Senior architect
---

Architect things.
`;

    let lock = createEmptyLock();
    const agentEntry: LockEntry = {
      type: 'agent',
      name: 'architect',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(originalAgent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [],
    };
    lock = upsertLockEntry(lock, agentEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await checkRuleUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('Agent');
    expect(result.errors[0]!.error).toContain('no longer found');
  });
});

describe('updateRules', () => {
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

  it('returns empty result when no rules in lock file', async () => {
    await writeDotaiLock(createEmptyLock(), projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it('reports all up to date when content is unchanged', async () => {
    const content = makeRulesContent('code-style', 'Enforce code style', 'Use const');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it('updates rule when content has changed', async () => {
    const originalContent = makeRulesContent('code-style', 'Enforce code style', 'Use const');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Use const ALWAYS' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, originalContent));
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.messages.some((m) => m.includes('Updated: code-style'))).toBe(true);
  });

  it('writes updated transpiled files to disk', async () => {
    const originalContent = makeRulesContent('code-style', 'Enforce code style', 'Old body');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'New body content' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, originalContent));
    await writeDotaiLock(lock, projectDir);

    await updateRules(projectDir);

    // Verify transpiled files exist for all 4 agents
    expect(
      existsSync(join(projectDir, '.github', 'instructions', 'code-style.instructions.md'))
    ).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'rules', 'code-style.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'code-style.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.opencode', 'rules', 'code-style.md'))).toBe(true);

    // Verify updated content is in transpiled output
    const cursorContent = readFileSync(
      join(projectDir, '.cursor', 'rules', 'code-style.mdc'),
      'utf-8'
    );
    expect(cursorContent).toContain('New body content');
  });

  it('updates lock file with new hash', async () => {
    const originalContent = makeRulesContent('code-style', 'Enforce code style', 'Old body');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'New body' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, originalContent));
    await writeDotaiLock(lock, projectDir);

    const originalHash = computeContentHash(originalContent);

    await updateRules(projectDir);

    // Read updated lock file
    const updatedLockContent = readFileSync(join(projectDir, '.dotai-lock.json'), 'utf-8');
    const updatedLock = JSON.parse(updatedLockContent) as DotaiLockFile;

    const updatedEntry = updatedLock.items.find((i) => i.name === 'code-style');
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry!.hash).not.toBe(originalHash);
  });

  it('preserves installedAt on update', async () => {
    const originalContent = makeRulesContent('code-style', 'Enforce code style', 'Old');
    const originalInstalledAt = '2025-01-01T00:00:00.000Z';
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'New' },
    ]);

    const entry = makeLockEntry('code-style', sourceRepo, originalContent);
    entry.installedAt = originalInstalledAt;

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, entry);
    await writeDotaiLock(lock, projectDir);

    await updateRules(projectDir);

    const updatedLockContent = readFileSync(join(projectDir, '.dotai-lock.json'), 'utf-8');
    const updatedLock = JSON.parse(updatedLockContent) as DotaiLockFile;

    const updatedEntry = updatedLock.items.find((i) => i.name === 'code-style');
    expect(updatedEntry!.installedAt).toBe(originalInstalledAt);
  });

  it('does not write lock file if no updates', async () => {
    const content = makeRulesContent('code-style', 'Enforce code style', 'Same body');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'code-style', description: 'Enforce code style', body: 'Same body' },
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('code-style', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    // Record lock file modification time
    const { statSync } = await import('fs');
    const mtimeBefore = statSync(join(projectDir, '.dotai-lock.json')).mtimeMs;

    // Small delay to ensure mtime would change if file were written
    await new Promise((r) => setTimeout(r, 50));

    await updateRules(projectDir);

    const mtimeAfter = statSync(join(projectDir, '.dotai-lock.json')).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('handles rule removed from source gracefully', async () => {
    const content = makeRulesContent('old-rule', 'Old rule', 'body');
    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'other-rule', description: 'Other rule', body: 'other body' },
    ]);

    // Lock has old-rule, but source only has other-rule now
    // We need the check to detect a change first, so use different content
    let lock = createEmptyLock();
    // old-rule has a hash that won't match anything in the source
    const entry = makeLockEntry('old-rule', sourceRepo, content);
    lock = upsertLockEntry(lock, entry);
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    // The rule is not found in source — reported as error in check, not as update
    // So updateRules won't try to update it
    expect(result.totalChecked).toBe(1);
  });

  it('handles multiple rules with mixed updates', async () => {
    const contentA = makeRulesContent('rule-a', 'Rule A', 'body a');
    const contentB = makeRulesContent('rule-b', 'Rule B', 'body b');

    const sourceRepo = await createSourceRepo(tempDir, [
      { name: 'rule-a', description: 'Rule A', body: 'body a' }, // unchanged
      { name: 'rule-b', description: 'Rule B', body: 'body b UPDATED' }, // changed
    ]);

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeLockEntry('rule-a', sourceRepo, contentA));
    lock = upsertLockEntry(lock, makeLockEntry('rule-b', sourceRepo, contentB));
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.messages.some((m) => m.includes('Updated: rule-b'))).toBe(true);
  });

  it('updates prompt when content has changed', async () => {
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    // Source has updated prompt content
    const updatedPromptContent = `---
name: review-code
description: Review code for issues
---

Review the code for bugs and security issues.
`;
    await writeFile(join(sourceRepo, 'PROMPT.md'), updatedPromptContent);

    const originalPromptContent = `---
name: review-code
description: Review code for issues
---

Review the code for bugs.
`;

    let lock = createEmptyLock();
    const promptEntry: LockEntry = {
      type: 'prompt',
      name: 'review-code',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(originalPromptContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [
        join(projectDir, '.github', 'prompts', 'review-code.prompt.md'),
        join(projectDir, '.claude', 'commands', 'review-code.md'),
      ],
    };
    lock = upsertLockEntry(lock, promptEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.messages.some((m) => m.includes('Updated: review-code'))).toBe(true);

    // Verify transpiled prompt files exist
    expect(existsSync(join(projectDir, '.github', 'prompts', 'review-code.prompt.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'commands', 'review-code.md'))).toBe(true);
  });

  it('updates agent when content has changed', async () => {
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    // Source has updated agent content
    const updatedAgentContent = `---
name: architect
description: Senior architect for code review
---

You are a senior software architect. Focus on security.
`;
    await writeFile(join(sourceRepo, 'AGENT.md'), updatedAgentContent);

    const originalAgentContent = `---
name: architect
description: Senior architect for code review
---

You are a senior software architect.
`;

    let lock = createEmptyLock();
    const agentEntry: LockEntry = {
      type: 'agent',
      name: 'architect',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code'],
      hash: computeContentHash(originalAgentContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [
        join(projectDir, '.github', 'agents', 'architect.agent.md'),
        join(projectDir, '.claude', 'agents', 'architect.md'),
      ],
    };
    lock = upsertLockEntry(lock, agentEntry);
    await writeDotaiLock(lock, projectDir);

    const result = await updateRules(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.messages.some((m) => m.includes('Updated: architect'))).toBe(true);

    // Verify transpiled agent files exist
    expect(existsSync(join(projectDir, '.github', 'agents', 'architect.agent.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'agents', 'architect.md'))).toBe(true);
  });
});
