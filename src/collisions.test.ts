import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  checkCollisions,
  createPlannedWrite,
  filterBlockingCollisions,
  formatCollision,
} from './collisions.ts';
import type {
  Collision,
  LockEntry,
  PlannedWrite,
  TranspiledOutput,
  ContextType,
  ContextFormat,
  TargetAgent,
} from './types.ts';

/** Assert exactly one collision and return it (avoids TS "possibly undefined" on collisions[0]). */
function expectSingleCollision(collisions: Collision[]): Collision {
  expect(collisions).toHaveLength(1);
  return collisions[0]!;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

function makeTestDir(): string {
  const dir = join(
    tmpdir(),
    `dotai-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeOutput(overrides: Partial<TranspiledOutput> = {}): TranspiledOutput {
  return {
    filename: 'code-style.mdc',
    content: '---\ndescription: test\n---\ntest body\n',
    outputDir: '.cursor/rules',
    mode: 'write',
    ...overrides,
  };
}

function makePlannedWrite(
  projectRoot: string,
  overrides: {
    output?: Partial<TranspiledOutput>;
    type?: ContextType;
    name?: string;
    format?: ContextFormat;
    source?: string;
  } = {}
): PlannedWrite {
  const output = makeOutput(overrides.output);
  return createPlannedWrite(
    output,
    projectRoot,
    overrides.type ?? 'prompt',
    overrides.name ?? 'code-style',
    overrides.format ?? 'canonical',
    overrides.source ?? 'acme/repo-a'
  );
}

function makeLockEntry(overrides: Partial<LockEntry> = {}): LockEntry {
  return {
    type: 'prompt',
    name: 'code-style',
    source: 'acme/repo-a',
    format: 'canonical',
    agents: ['cursor'] as TargetAgent[],
    hash: 'abc123',
    installedAt: '2026-02-28T12:00:00Z',
    outputs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collisions', () => {
  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createPlannedWrite
  // -------------------------------------------------------------------------

  describe('createPlannedWrite', () => {
    it('resolves absolute path from projectRoot + outputDir + filename', () => {
      const output = makeOutput();
      const pw = createPlannedWrite(
        output,
        '/project',
        'prompt',
        'code-style',
        'canonical',
        'acme/repo'
      );
      expect(pw.absolutePath).toBe(resolve('/project/.cursor/rules/code-style.mdc'));
    });

    it('carries metadata through', () => {
      const output = makeOutput();
      const pw = createPlannedWrite(
        output,
        '/project',
        'prompt',
        'code-style',
        'canonical',
        'acme/repo'
      );
      expect(pw.type).toBe('prompt');
      expect(pw.name).toBe('code-style');
      expect(pw.format).toBe('canonical');
      expect(pw.source).toBe('acme/repo');
      expect(pw.output).toBe(output);
    });
  });

  // -------------------------------------------------------------------------
  // No collisions
  // -------------------------------------------------------------------------

  describe('no collisions', () => {
    it('returns empty array when no conflicts exist', () => {
      const writes = [makePlannedWrite(testDir)];
      const collisions = checkCollisions(writes, {
        projectRoot: testDir,
        lockEntries: [],
      });
      expect(collisions).toEqual([]);
    });

    it('returns empty for empty planned writes', () => {
      const collisions = checkCollisions([], {
        projectRoot: testDir,
        lockEntries: [],
      });
      expect(collisions).toEqual([]);
    });

    it('allows re-install of same item from same source (update path)', () => {
      const pw = makePlannedWrite(testDir);
      const lockEntry = makeLockEntry({
        outputs: [pw.absolutePath],
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });
      expect(collisions).toEqual([]);
    });

    it('allows multiple writes to different paths', () => {
      const pw1 = makePlannedWrite(testDir, {
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
        name: 'code-style',
      });
      const pw2 = makePlannedWrite(testDir, {
        output: { filename: 'security.mdc', outputDir: '.cursor/rules' },
        name: 'security',
      });
      const collisions = checkCollisions([pw1, pw2], {
        projectRoot: testDir,
        lockEntries: [],
      });
      expect(collisions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // File-exists collisions (user-owned files)
  // -------------------------------------------------------------------------

  describe('file-exists collisions (user-owned)', () => {
    it('detects user-owned file at target path', () => {
      const rulesDir = join(testDir, '.cursor', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'code-style.mdc'), 'user content');

      const pw = makePlannedWrite(testDir);
      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [],
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('file-exists');
      expect(c.existingSource).toBe('user');
      expect(c.message).toContain('already exists');
      expect(c.message).toContain('not managed by dotai');
      expect(c.message).toContain('--force');
    });

    it('skips fs check when skipFsCheck is true', () => {
      const rulesDir = join(testDir, '.cursor', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'code-style.mdc'), 'user content');

      const pw = makePlannedWrite(testDir);
      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      expect(collisions).toEqual([]);
    });

    it('does not flag non-existent files', () => {
      const pw = makePlannedWrite(testDir);
      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [],
      });
      expect(collisions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // File-exists collisions (dotai-managed, different item)
  // -------------------------------------------------------------------------

  describe('file-exists collisions (dotai-managed)', () => {
    it('detects dotai-managed file at target path owned by different item', () => {
      const pw = makePlannedWrite(testDir, {
        name: 'security',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      const lockEntry = makeLockEntry({
        name: 'code-style',
        outputs: [pw.absolutePath],
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('file-exists');
      expect(c.existingSource).toBe('dotai');
      expect(c.existingItem).toEqual(lockEntry);
      expect(c.message).toContain('already managed by dotai');
    });
  });

  // -------------------------------------------------------------------------
  // Same-name collisions (different source)
  // -------------------------------------------------------------------------

  describe('same-name collisions', () => {
    it('detects same (type, name) from different source', () => {
      const pw = makePlannedWrite(testDir, { source: 'acme/repo-b' });

      const lockEntry = makeLockEntry({
        source: 'acme/repo-a',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('same-name');
      expect(c.existingSource).toBe('dotai');
      expect(c.existingItem).toEqual(lockEntry);
      expect(c.message).toContain('already installed from acme/repo-a');
      expect(c.message).toContain('--force');
    });

    it('allows same (type, name) from same source (update)', () => {
      const pw = makePlannedWrite(testDir, { source: 'acme/repo-a' });

      const lockEntry = makeLockEntry({
        source: 'acme/repo-a',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      expect(collisions).toEqual([]);
    });

    it('allows same name with different type', () => {
      const pw = makePlannedWrite(testDir, { type: 'skill', name: 'code-style' });

      const lockEntry = makeLockEntry({
        type: 'prompt',
        name: 'code-style',
        source: 'acme/repo-b',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      // No same-name collision because types differ
      expect(collisions.filter((c) => c.kind === 'same-name')).toEqual([]);
    });

    it('allows a prompt and an instruction with the same name (no collision)', () => {
      const pw = makePlannedWrite(testDir, {
        type: 'prompt',
        name: 'review-code',
        source: 'acme/repo-b',
        output: { filename: 'review-code.prompt.md', outputDir: '.github/prompts' },
      });

      const lockEntry = makeLockEntry({
        type: 'instruction',
        name: 'review-code',
        source: 'acme/repo-a',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      // No same-name collision because types differ (prompt vs instruction)
      expect(collisions.filter((c) => c.kind === 'same-name')).toEqual([]);
    });

    it('detects same-name collision for two prompts from different sources', () => {
      const pw = makePlannedWrite(testDir, {
        type: 'prompt',
        name: 'review-code',
        source: 'acme/repo-b',
        output: { filename: 'review-code.prompt.md', outputDir: '.github/prompts' },
      });

      const lockEntry = makeLockEntry({
        type: 'prompt',
        name: 'review-code',
        source: 'acme/repo-a',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('same-name');
      expect(c.message).toContain('already installed from acme/repo-a');
    });

    it('same-name takes priority over file-exists', () => {
      // Even if the file also exists on disk, same-name is the more important collision
      const rulesDir = join(testDir, '.cursor', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'code-style.mdc'), 'user content');

      const pw = makePlannedWrite(testDir, { source: 'acme/repo-b' });

      const lockEntry = makeLockEntry({
        source: 'acme/repo-a',
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      // Should only get same-name, not file-exists
      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('same-name');
    });
  });

  // -------------------------------------------------------------------------
  // Canonical/native collisions (within same batch)
  // -------------------------------------------------------------------------

  describe('canonical-native collisions', () => {
    it('detects canonical item colliding with native passthrough at same path', () => {
      // Both target the same output path
      const canonicalWrite = makePlannedWrite(testDir, {
        format: 'canonical',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });
      const nativeWrite = makePlannedWrite(testDir, {
        format: 'native:cursor',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      // Native first, canonical second — canonical gets the collision
      const collisions = checkCollisions([nativeWrite, canonicalWrite], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('canonical-native');
      expect(c.message).toContain('canonical');
      expect(c.message).toContain('native');
      expect(c.message).toContain('Prefer the native file');
    });

    it('detects collision regardless of order (canonical first, native second)', () => {
      const canonicalWrite = makePlannedWrite(testDir, {
        format: 'canonical',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });
      const nativeWrite = makePlannedWrite(testDir, {
        format: 'native:cursor',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      // Canonical first, native second — native gets the collision reported
      // (because canonical is already in batchPaths)
      const collisions = checkCollisions([canonicalWrite, nativeWrite], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('canonical-native');
    });

    it('does not flag two canonical items at the same path as canonical-native', () => {
      // Two canonicals at the same path is NOT a canonical-native collision
      // (it would be a bug or a file-exists collision)
      const pw1 = makePlannedWrite(testDir, {
        format: 'canonical',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });
      const pw2 = makePlannedWrite(testDir, {
        format: 'canonical',
        name: 'other-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      const collisions = checkCollisions([pw1, pw2], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      // No canonical-native collision
      expect(collisions.filter((c) => c.kind === 'canonical-native')).toEqual([]);
    });

    it('does not flag two native items at the same path as canonical-native', () => {
      const pw1 = makePlannedWrite(testDir, {
        format: 'native:cursor',
        name: 'code-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });
      const pw2 = makePlannedWrite(testDir, {
        format: 'native:cursor',
        name: 'other-style',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      const collisions = checkCollisions([pw1, pw2], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      expect(collisions.filter((c) => c.kind === 'canonical-native')).toEqual([]);
    });

    it('detects canonical prompt colliding with native prompt at same path', () => {
      const canonicalWrite = makePlannedWrite(testDir, {
        type: 'prompt',
        format: 'canonical',
        name: 'review-code',
        output: { filename: 'review-code.prompt.md', outputDir: '.github/prompts' },
      });
      const nativeWrite = makePlannedWrite(testDir, {
        type: 'prompt',
        format: 'native:github-copilot',
        name: 'review-code',
        output: { filename: 'review-code.prompt.md', outputDir: '.github/prompts' },
      });

      const collisions = checkCollisions([nativeWrite, canonicalWrite], {
        projectRoot: testDir,
        lockEntries: [],
        skipFsCheck: true,
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('canonical-native');
    });
  });

  // -------------------------------------------------------------------------
  // Multiple collisions
  // -------------------------------------------------------------------------

  describe('multiple collisions', () => {
    it('detects multiple collisions across different writes', () => {
      const rulesDir = join(testDir, '.opencode', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'security.md'), 'existing');

      const pw1 = makePlannedWrite(testDir, {
        source: 'acme/repo-b',
        name: 'code-style',
      });
      const pw2 = makePlannedWrite(testDir, {
        name: 'security',
        output: { filename: 'security.md', outputDir: '.opencode/rules' },
      });

      const lockEntry = makeLockEntry({
        source: 'acme/repo-a',
        name: 'code-style',
      });

      const collisions = checkCollisions([pw1, pw2], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      expect(collisions).toHaveLength(2);
      expect(collisions[0]!.kind).toBe('same-name');
      expect(collisions[1]!.kind).toBe('file-exists');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-agent writes
  // -------------------------------------------------------------------------

  describe('multi-agent writes', () => {
    it('handles writes to multiple agent directories without collisions', () => {
      const writes = [
        makePlannedWrite(testDir, {
          output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
        }),
        makePlannedWrite(testDir, {
          output: { filename: 'code-style.instructions.md', outputDir: '.github/instructions' },
        }),
        makePlannedWrite(testDir, {
          output: { filename: 'code-style.md', outputDir: '.claude/rules' },
        }),
        makePlannedWrite(testDir, {
          output: { filename: 'code-style.md', outputDir: '.opencode/rules' },
        }),
      ];

      const collisions = checkCollisions(writes, {
        projectRoot: testDir,
        lockEntries: [],
      });

      expect(collisions).toEqual([]);
    });

    it('handles prompt writes to multiple agent directories without collisions', () => {
      const writes = [
        makePlannedWrite(testDir, {
          type: 'prompt',
          name: 'review-code',
          output: { filename: 'review-code.prompt.md', outputDir: '.github/prompts' },
        }),
        makePlannedWrite(testDir, {
          type: 'prompt',
          name: 'review-code',
          output: { filename: 'review-code.md', outputDir: '.claude/commands' },
        }),
      ];

      const collisions = checkCollisions(writes, {
        projectRoot: testDir,
        lockEntries: [],
      });

      expect(collisions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // filterBlockingCollisions
  // -------------------------------------------------------------------------

  describe('filterBlockingCollisions', () => {
    const collision: Collision = {
      kind: 'file-exists',
      path: '/project/.cursor/rules/code-style.mdc',
      existingSource: 'user',
      message: 'test collision',
    };

    it('returns all collisions when force is false', () => {
      const result = filterBlockingCollisions([collision], false);
      expect(result).toEqual([collision]);
    });

    it('returns empty array when force is true', () => {
      const result = filterBlockingCollisions([collision], true);
      expect(result).toEqual([]);
    });

    it('returns empty for no collisions regardless of force', () => {
      expect(filterBlockingCollisions([], false)).toEqual([]);
      expect(filterBlockingCollisions([], true)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // formatCollision
  // -------------------------------------------------------------------------

  describe('formatCollision', () => {
    it('formats collision with Conflict prefix', () => {
      const collision: Collision = {
        kind: 'file-exists',
        path: '/project/.cursor/rules/code-style.mdc',
        existingSource: 'user',
        message: '.cursor/rules/code-style.mdc already exists and is not managed by dotai.',
      };
      const formatted = formatCollision(collision);
      expect(formatted).toBe(
        'Conflict: .cursor/rules/code-style.mdc already exists and is not managed by dotai.'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles lock entries with empty outputs array', () => {
      const pw = makePlannedWrite(testDir);
      const lockEntry = makeLockEntry({ outputs: [] });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
        skipFsCheck: true,
      });

      // No file-exists collision (no outputs), no same-name (same source)
      expect(collisions).toEqual([]);
    });

    it('handles lock entry with multiple outputs', () => {
      const pw = makePlannedWrite(testDir, {
        name: 'security',
        output: { filename: 'code-style.mdc', outputDir: '.cursor/rules' },
      });

      const lockEntry = makeLockEntry({
        name: 'code-style',
        outputs: [pw.absolutePath, resolve(join(testDir, '.opencode/rules/code-style.md'))],
      });

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: [lockEntry],
      });

      const c = expectSingleCollision(collisions);
      expect(c.kind).toBe('file-exists');
      expect(c.existingSource).toBe('dotai');
    });

    it('handles multiple lock entries', () => {
      const pw = makePlannedWrite(testDir, {
        name: 'third-rule',
        source: 'acme/repo-c',
      });

      const entries = [
        makeLockEntry({ name: 'first', source: 'acme/repo-a' }),
        makeLockEntry({ name: 'second', source: 'acme/repo-b' }),
      ];

      const collisions = checkCollisions([pw], {
        projectRoot: testDir,
        lockEntries: entries,
        skipFsCheck: true,
      });

      expect(collisions).toEqual([]);
    });
  });
});
