import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { checkContextUpdates, updateContext } from './context-check.ts';
import {
  writeDotaiLock,
  createEmptyLock,
  upsertLockEntry,
  computeContentHash,
} from '../lock/index.ts';
import type { DotaiLockFile } from '../lock/index.ts';
import type { LockEntry, TargetAgent } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'instruction-check-test-'));
}

/** Create canonical INSTRUCTIONS.md content. */
function makeInstructionContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
schema-version: 1
---

${body}
`;
}

/** Create a source repo with an INSTRUCTIONS.md at the root. */
async function createSourceRepoWithInstruction(
  tempDir: string,
  instruction: { name: string; description: string; body: string }
): Promise<string> {
  const repoDir = join(tempDir, 'source-repo');
  await mkdir(repoDir, { recursive: true });
  await writeFile(
    join(repoDir, 'INSTRUCTIONS.md'),
    makeInstructionContent(instruction.name, instruction.description, instruction.body)
  );
  return repoDir;
}

/** Create a lock entry for an instruction. */
function makeInstructionLockEntry(
  name: string,
  source: string,
  rawContent: string,
  agents: TargetAgent[] = ['github-copilot', 'claude-code', 'cursor', 'opencode']
): LockEntry {
  return {
    type: 'instruction',
    name,
    source,
    format: 'canonical',
    agents,
    hash: computeContentHash(rawContent),
    installedAt: '2026-02-28T00:00:00.000Z',
    outputs: [],
    append: true,
  };
}

// ---------------------------------------------------------------------------
// checkContextUpdates — instruction entries
// ---------------------------------------------------------------------------

describe('checkContextUpdates — instructions', () => {
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

  it('detects no updates when instruction content is unchanged', async () => {
    const content = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Use TypeScript strict mode.'
    );
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'Use TypeScript strict mode.',
    });

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeInstructionLockEntry('coding-standards', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await checkContextUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects update when instruction content has changed', async () => {
    const originalContent = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Use TypeScript strict mode.'
    );
    // Source has updated content
    await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'Use TypeScript strict mode. Always use const.',
    });

    let lock = createEmptyLock();
    const sourceRepo = join(tempDir, 'source-repo');
    lock = upsertLockEntry(
      lock,
      makeInstructionLockEntry('coding-standards', sourceRepo, originalContent)
    );
    await writeDotaiLock(lock, projectDir);

    const result = await checkContextUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.entry.name).toBe('coding-standards');
    expect(result.updates[0]!.entry.type).toBe('instruction');
    expect(result.updates[0]!.currentHash).toBe(computeContentHash(originalContent));
    expect(result.updates[0]!.latestHash).not.toBe(result.updates[0]!.currentHash);
  });

  it('reports error when instruction is no longer in source', async () => {
    const content = makeInstructionContent('old-instruction', 'Old instruction', 'Old body');
    // Source has a different instruction
    await createSourceRepoWithInstruction(tempDir, {
      name: 'new-instruction',
      description: 'New instruction',
      body: 'New body',
    });

    let lock = createEmptyLock();
    const sourceRepo = join(tempDir, 'source-repo');
    lock = upsertLockEntry(lock, makeInstructionLockEntry('old-instruction', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await checkContextUpdates(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('Instruction');
    expect(result.errors[0]!.error).toContain('no longer found');
  });

  it('checks instructions alongside prompts', async () => {
    // Create source repo with both a prompt and an instruction
    const sourceRepo = join(tempDir, 'source-repo');
    await mkdir(sourceRepo, { recursive: true });

    const promptContent = `---
name: code-style
description: Enforce code style
---

Use const over let.
`;
    await writeFile(join(sourceRepo, 'PROMPT.md'), promptContent);

    const instrContent = makeInstructionContent(
      'team-standards',
      'Team standards',
      'Follow our coding guidelines.'
    );
    await writeFile(join(sourceRepo, 'INSTRUCTIONS.md'), instrContent);

    let lock = createEmptyLock();
    // Add prompt entry
    const promptEntry: LockEntry = {
      type: 'prompt',
      name: 'code-style',
      source: sourceRepo,
      format: 'canonical',
      agents: ['github-copilot', 'claude-code', 'cursor', 'opencode'],
      hash: computeContentHash(promptContent),
      installedAt: '2026-02-28T00:00:00.000Z',
      outputs: [],
    };
    lock = upsertLockEntry(lock, promptEntry);
    // Add instruction entry
    lock = upsertLockEntry(
      lock,
      makeInstructionLockEntry('team-standards', sourceRepo, instrContent)
    );
    await writeDotaiLock(lock, projectDir);

    const result = await checkContextUpdates(projectDir);

    expect(result.totalChecked).toBe(2);
    expect(result.updates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateContext — instruction entries
// ---------------------------------------------------------------------------

describe('updateContext — instructions', () => {
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

  it('reports all up to date when instruction content is unchanged', async () => {
    const content = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Use TypeScript strict mode.'
    );
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'Use TypeScript strict mode.',
    });

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, makeInstructionLockEntry('coding-standards', sourceRepo, content));
    await writeDotaiLock(lock, projectDir);

    const result = await updateContext(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it('updates instruction when content has changed', async () => {
    const originalContent = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Use TypeScript strict mode.'
    );
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'Use TypeScript strict mode. Always prefer const.',
    });

    let lock = createEmptyLock();
    lock = upsertLockEntry(
      lock,
      makeInstructionLockEntry('coding-standards', sourceRepo, originalContent)
    );
    await writeDotaiLock(lock, projectDir);

    const result = await updateContext(projectDir);

    expect(result.totalChecked).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.messages.some((m) => m.includes('Updated: coding-standards'))).toBe(true);
  });

  it('writes updated instruction files to disk using append markers', async () => {
    const originalContent = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Old body'
    );
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'New body content',
    });

    let lock = createEmptyLock();
    lock = upsertLockEntry(
      lock,
      makeInstructionLockEntry('coding-standards', sourceRepo, originalContent)
    );
    await writeDotaiLock(lock, projectDir);

    await updateContext(projectDir);

    // Instructions use append mode — verify marker sections exist in target files.
    // Copilot: .github/copilot-instructions.md
    const copilotPath = join(projectDir, '.github', 'copilot-instructions.md');
    expect(existsSync(copilotPath)).toBe(true);
    const copilotContent = readFileSync(copilotPath, 'utf-8');
    expect(copilotContent).toContain('dotai:coding-standards:start');
    expect(copilotContent).toContain('New body content');
    expect(copilotContent).toContain('dotai:coding-standards:end');

    // Claude: CLAUDE.md
    const claudePath = join(projectDir, 'CLAUDE.md');
    expect(existsSync(claudePath)).toBe(true);
    const claudeContent = readFileSync(claudePath, 'utf-8');
    expect(claudeContent).toContain('New body content');

    // Cursor + OpenCode share AGENTS.md
    const agentsPath = join(projectDir, 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);
    const agentsContent = readFileSync(agentsPath, 'utf-8');
    expect(agentsContent).toContain('New body content');
  });

  it('updates lock file with new hash after instruction update', async () => {
    const originalContent = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Old body'
    );
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'New body',
    });

    let lock = createEmptyLock();
    lock = upsertLockEntry(
      lock,
      makeInstructionLockEntry('coding-standards', sourceRepo, originalContent)
    );
    await writeDotaiLock(lock, projectDir);

    const originalHash = computeContentHash(originalContent);

    await updateContext(projectDir);

    const updatedLockContent = readFileSync(join(projectDir, '.dotai-lock.json'), 'utf-8');
    const updatedLock = JSON.parse(updatedLockContent) as DotaiLockFile;

    const updatedEntry = updatedLock.items.find((i) => i.name === 'coding-standards');
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry!.hash).not.toBe(originalHash);
    expect(updatedEntry!.type).toBe('instruction');
  });

  it('preserves installedAt on instruction update', async () => {
    const originalContent = makeInstructionContent(
      'coding-standards',
      'Team coding standards',
      'Old'
    );
    const originalInstalledAt = '2025-01-01T00:00:00.000Z';
    const sourceRepo = await createSourceRepoWithInstruction(tempDir, {
      name: 'coding-standards',
      description: 'Team coding standards',
      body: 'New',
    });

    const entry = makeInstructionLockEntry('coding-standards', sourceRepo, originalContent);
    entry.installedAt = originalInstalledAt;

    let lock = createEmptyLock();
    lock = upsertLockEntry(lock, entry);
    await writeDotaiLock(lock, projectDir);

    await updateContext(projectDir);

    const updatedLockContent = readFileSync(join(projectDir, '.dotai-lock.json'), 'utf-8');
    const updatedLock = JSON.parse(updatedLockContent) as DotaiLockFile;

    const updatedEntry = updatedLock.items.find((i) => i.name === 'coding-standards');
    expect(updatedEntry!.installedAt).toBe(originalInstalledAt);
  });
});
