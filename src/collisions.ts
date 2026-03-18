import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type {
  Collision,
  CollisionKind,
  CollisionSource,
  LockEntry,
  PlannedWrite,
  TranspiledOutput,
  ContextType,
  ContextFormat,
  TargetAgent,
} from './types.ts';

// ---------------------------------------------------------------------------
// Collision detection — Phase 5: Installer + Collision Safety
//
// All collision checks run BEFORE any writes (transactional check-then-write).
// The installer calls `checkCollisions()` with the planned writes and existing
// lock entries to detect conflicts. If any collisions are found, the install
// is aborted unless `--force` is used.
//
// Three collision types:
// 1. file-exists — a file already exists at the target path (user-owned or dotai-managed)
// 2. same-name — another item with (type, name) already installed from a different source
// 3. canonical-native — canonical transpile target collides with native passthrough from same repo
//
// Reference: PRD.md Phase 5, dotai-plan.md "Conflict & Collision Handling"
// ---------------------------------------------------------------------------

/**
 * Options for collision checking.
 */
export interface CheckCollisionOptions {
  /** Project root directory (absolute path). */
  projectRoot: string;
  /** Existing lock entries for previously installed items. */
  lockEntries: LockEntry[];
  /** Whether to skip file-system existence checks (for testing). */
  skipFsCheck?: boolean;
}

/**
 * Create a PlannedWrite from a TranspiledOutput with metadata.
 */
export function createPlannedWrite(
  output: TranspiledOutput,
  projectRoot: string,
  type: ContextType,
  name: string,
  format: ContextFormat,
  source: string
): PlannedWrite {
  const absolutePath = resolve(join(projectRoot, output.outputDir, output.filename));
  return {
    absolutePath,
    output,
    type,
    name,
    format,
    source,
  };
}

/**
 * Check all planned writes for collisions.
 *
 * Detects three types of collisions:
 * 1. **file-exists**: A file already exists at the target path and is not tracked
 *    by dotai, or is tracked but belongs to a different item.
 * 2. **same-name**: Another item with the same (type, name) is already installed
 *    from a different source.
 * 3. **canonical-native**: A canonical item would transpile to a path that is also
 *    targeted by a native passthrough item from the same batch.
 *
 * Returns an empty array if no collisions are detected.
 */
export function checkCollisions(
  plannedWrites: PlannedWrite[],
  options: CheckCollisionOptions
): Collision[] {
  const collisions: Collision[] = [];

  // Build lookup indexes
  const lockByPath = buildPathIndex(options.lockEntries);
  const lockByKey = buildKeyIndex(options.lockEntries);

  // Track paths within this batch to detect canonical/native collisions
  const batchPaths = new Map<string, PlannedWrite>();

  for (const write of plannedWrites) {
    // 1. Check for same-name collisions (different source, same type+name)
    const sameNameCollision = checkSameNameCollision(write, lockByKey);
    if (sameNameCollision) {
      collisions.push(sameNameCollision);
      // Don't check further — same-name is the highest-priority collision
      continue;
    }

    // 2. Check for canonical/native collisions within the same batch
    const canonicalNativeCollision = checkCanonicalNativeCollision(write, batchPaths);
    if (canonicalNativeCollision) {
      collisions.push(canonicalNativeCollision);
      continue;
    }

    // 3. Check for file-exists collisions
    // Skip for append-mode writes — append targets (AGENTS.md, CLAUDE.md) are
    // designed to coexist with existing content via marker-based sections.
    if (write.output.mode !== 'append') {
      const fileCollision = checkFileExistsCollision(write, lockByPath, options);
      if (fileCollision) {
        collisions.push(fileCollision);
        continue;
      }
    }

    // No collision — register this write's path for batch-internal checks
    batchPaths.set(write.absolutePath, write);
  }

  return collisions;
}

/**
 * Filter collisions, returning only those that would block installation.
 * With `--force`, all collisions become warnings instead of errors.
 */
export function filterBlockingCollisions(collisions: Collision[], force: boolean): Collision[] {
  if (force) {
    return [];
  }
  return collisions;
}

/**
 * Format a collision as a human-readable message for CLI output.
 */
export function formatCollision(collision: Collision): string {
  return `Conflict: ${collision.message}`;
}

// ---------------------------------------------------------------------------
// Internal: collision check implementations
// ---------------------------------------------------------------------------

/**
 * Check if a planned write conflicts with an existing lock entry that has
 * the same (type, name) but a different source.
 */
function checkSameNameCollision(
  write: PlannedWrite,
  lockByKey: Map<string, LockEntry>
): Collision | null {
  const key = lockKey(write.type, write.name);
  const existing = lockByKey.get(key);

  if (!existing) {
    return null;
  }

  // Same source = update, not a collision
  if (existing.source === write.source) {
    return null;
  }

  return {
    kind: 'same-name',
    path: write.absolutePath,
    existingSource: 'dotai',
    existingItem: existing,
    message:
      `${write.type} '${write.name}' is already installed from ${existing.source}. ` +
      `Use --force to replace.`,
  };
}

/**
 * Check if a canonical item's transpiled output path collides with a native
 * passthrough item's output path within the same batch.
 *
 * When both exist, prefer the native item (it's more specific). The canonical
 * item gets the collision.
 */
function checkCanonicalNativeCollision(
  write: PlannedWrite,
  batchPaths: Map<string, PlannedWrite>
): Collision | null {
  const existing = batchPaths.get(write.absolutePath);

  if (!existing) {
    return null;
  }

  // Only flag canonical/native conflicts, not two canonicals or two natives
  // targeting the same path (which is an internal bug, not a user collision).
  const oneCanonical =
    (write.format === 'canonical' && existing.format !== 'canonical') ||
    (write.format !== 'canonical' && existing.format === 'canonical');

  if (!oneCanonical) {
    return null;
  }

  // The canonical item gets the collision; native is preferred
  const canonicalWrite = write.format === 'canonical' ? write : existing;
  const nativeWrite = write.format === 'canonical' ? existing : write;

  return {
    kind: 'canonical-native',
    path: canonicalWrite.absolutePath,
    existingSource: 'dotai',
    message:
      `canonical ${canonicalWrite.type} '${canonicalWrite.name}' would write to ` +
      `${canonicalWrite.output.outputDir}/${canonicalWrite.output.filename} which is also targeted ` +
      `by native ${nativeWrite.format} item '${nativeWrite.name}'. ` +
      `Prefer the native file; use --force to override.`,
  };
}

/**
 * Check if a file already exists at the planned write's target path.
 *
 * If the file is tracked by dotai (found in lock entries), it's only a
 * collision if it belongs to a different item. Re-installing the same item
 * (update) is not a collision.
 */
function checkFileExistsCollision(
  write: PlannedWrite,
  lockByPath: Map<string, LockEntry>,
  options: CheckCollisionOptions
): Collision | null {
  // Check if the path is tracked in the lock file
  const lockedEntry = lockByPath.get(write.absolutePath);

  if (lockedEntry) {
    // Same item, same source = update, not collision
    if (lockedEntry.type === write.type && lockedEntry.name === write.name) {
      return null;
    }

    // Different item owns this path
    return {
      kind: 'file-exists',
      path: write.absolutePath,
      existingSource: 'dotai',
      existingItem: lockedEntry,
      message:
        `${write.output.outputDir}/${write.output.filename} is already managed by dotai ` +
        `(${lockedEntry.type} '${lockedEntry.name}' from ${lockedEntry.source}). ` +
        `Use --force to overwrite.`,
    };
  }

  // Check filesystem — skip if testing without FS
  if (options.skipFsCheck) {
    return null;
  }

  if (existsSync(write.absolutePath)) {
    return {
      kind: 'file-exists',
      path: write.absolutePath,
      existingSource: 'user',
      message:
        `${write.output.outputDir}/${write.output.filename} already exists and is not managed ` +
        `by dotai. Use --force to overwrite.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal: index builders
// ---------------------------------------------------------------------------

/** Build an index from absolute output paths to their lock entries. */
function buildPathIndex(entries: LockEntry[]): Map<string, LockEntry> {
  const index = new Map<string, LockEntry>();
  for (const entry of entries) {
    for (const outputPath of entry.outputs) {
      index.set(outputPath, entry);
    }
  }
  return index;
}

/** Build an index from (type, name) keys to lock entries. */
function buildKeyIndex(entries: LockEntry[]): Map<string, LockEntry> {
  const index = new Map<string, LockEntry>();
  for (const entry of entries) {
    index.set(lockKey(entry.type, entry.name), entry);
  }
  return index;
}

/** Create a composite key for lock entry deduplication. */
function lockKey(type: ContextType, name: string): string {
  return `${type}:${name}`;
}
