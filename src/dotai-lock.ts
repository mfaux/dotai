import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

import type { LockEntry, ContextType, ContextFormat, TargetAgent } from './types.js';
import { LockVersionError } from './lock-version-error.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCK_FILENAME = '.dotai-lock.json';
const CURRENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Lock file types
// ---------------------------------------------------------------------------

/**
 * The dotai lock file schema.
 *
 * This file is project-scoped and always committed to version control.
 * Items are keyed by composite `(type, name)` to support multiple context
 * types sharing the same name (e.g., a skill and a rule both named "auth").
 */
export interface DotaiLockFile {
  /** Schema version — reject future versions, migrate older ones. */
  version: number;
  /** Installed context items. */
  items: LockEntry[];
}

/**
 * Result of reading a lock file — includes migration metadata.
 */
export interface ReadLockResult {
  /** The lock file contents (migrated if needed). */
  lock: DotaiLockFile;
  /** Whether the lock file was migrated from an older version. */
  migrated: boolean;
  /** The original version before migration (undefined if no migration). */
  originalVersion?: number;
}

// ---------------------------------------------------------------------------
// Version check + migration framework
// ---------------------------------------------------------------------------

/**
 * A migration function transforms a lock file from version N to version N+1.
 * Migrations are additive — they add missing fields with defaults.
 */
type MigrationFn = (lock: DotaiLockFile) => DotaiLockFile;

/**
 * Sequential migration registry.
 *
 * To add a new migration: add an entry `[N]: (lock) => { ... return lock; }`
 * where N is the version being migrated FROM (e.g., 1 → 2).
 *
 * Migrations run in order: v1→v2, v2→v3, etc.
 */
const migrations: Record<number, MigrationFn> = {
  // Example for future use:
  // 1: (lock) => {
  //   // v1 → v2: add a new field with default
  //   lock.version = 2;
  //   for (const item of lock.items) {
  //     (item as Record<string, unknown>).newField ??= 'default';
  //   }
  //   return lock;
  // },
};

/**
 * Validate and optionally migrate a parsed lock file.
 *
 * - Future versions (> CURRENT_VERSION): rejected with upgrade message.
 * - Current version: returned as-is.
 * - Older versions: migrated sequentially through each version step.
 * - Missing/invalid version: treated as corrupt, returns empty lock.
 */
function validateAndMigrate(parsed: unknown): ReadLockResult {
  if (!isPlainObject(parsed)) {
    return { lock: createEmptyLock(), migrated: false };
  }

  const obj = parsed as Record<string, unknown>;

  // Missing or invalid version field — treat as corrupt
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    return { lock: createEmptyLock(), migrated: false };
  }

  const version = obj.version;

  // Future version — reject with upgrade message
  if (version > CURRENT_VERSION) {
    throw new LockVersionError(version, CURRENT_VERSION, LOCK_FILENAME);
  }

  // Validate items array exists
  if (!Array.isArray(obj.items)) {
    return { lock: createEmptyLock(), migrated: false };
  }

  // Validate each item has required fields
  const validItems = (obj.items as unknown[]).filter(isValidLockEntry);

  let lock: DotaiLockFile = { version, items: validItems };

  // Run sequential migrations if needed
  if (version < CURRENT_VERSION) {
    const originalVersion = version;
    for (let v = version; v < CURRENT_VERSION; v++) {
      const migrateFn = migrations[v];
      if (migrateFn) {
        lock = migrateFn(lock);
      } else {
        // No migration function for this step — just bump version
        lock.version = v + 1;
      }
    }
    return { lock, migrated: true, originalVersion };
  }

  return { lock, migrated: false };
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * Get the path to the dotai lock file for a project.
 */
export function getDotaiLockPath(projectRoot: string): string {
  return join(projectRoot, LOCK_FILENAME);
}

/**
 * Read the dotai lock file from a project directory.
 *
 * Returns an empty lock file if the file doesn't exist or is corrupt.
 * Throws `LockVersionError` if the lock file is from a future version.
 */
export async function readDotaiLock(projectRoot: string): Promise<ReadLockResult> {
  const lockPath = getDotaiLockPath(projectRoot);

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    return validateAndMigrate(parsed);
  } catch (error) {
    if (error instanceof LockVersionError) {
      throw error;
    }
    // File doesn't exist, is invalid JSON, or read error — return empty
    return { lock: createEmptyLock(), migrated: false };
  }
}

/**
 * Write the dotai lock file atomically.
 *
 * Items are sorted by (type, name) for deterministic output and clean diffs.
 * Writes to a temp file first, then renames — prevents partial writes on failure.
 */
export async function writeDotaiLock(lock: DotaiLockFile, projectRoot: string): Promise<void> {
  const lockPath = getDotaiLockPath(projectRoot);
  const tempPath = lockPath + '.tmp';

  // Sort items by (type, name) for deterministic output
  const sortedItems = [...lock.items].sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    return a.name.localeCompare(b.name);
  });

  const sorted: DotaiLockFile = { version: lock.version, items: sortedItems };
  const content = JSON.stringify(sorted, null, 2) + '\n';

  // Atomic write: write to temp, then rename
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, lockPath);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Find a lock entry by (type, name) composite key.
 */
export function findLockEntry(
  lock: DotaiLockFile,
  type: ContextType,
  name: string
): LockEntry | undefined {
  return lock.items.find((item) => item.type === type && item.name === name);
}

/**
 * Add or update an item in the lock file.
 *
 * - If an entry with the same (type, name) exists, it is replaced (preserving
 *   the original `installedAt` timestamp for the update path).
 * - If no matching entry exists, a new one is added.
 */
export function upsertLockEntry(lock: DotaiLockFile, entry: LockEntry): DotaiLockFile {
  const idx = lock.items.findIndex((item) => item.type === entry.type && item.name === entry.name);

  const items = [...lock.items];
  if (idx >= 0) {
    // Preserve original installedAt for updates
    items[idx] = { ...entry, installedAt: items[idx]!.installedAt };
  } else {
    items.push(entry);
  }

  return { ...lock, items };
}

/**
 * Remove an item from the lock file by (type, name).
 * Returns the updated lock file and the removed entry (if any).
 */
export function removeLockEntry(
  lock: DotaiLockFile,
  type: ContextType,
  name: string
): { lock: DotaiLockFile; removed: LockEntry | undefined } {
  const idx = lock.items.findIndex((item) => item.type === type && item.name === name);

  if (idx < 0) {
    return { lock, removed: undefined };
  }

  const removed = lock.items[idx]!;
  const items = lock.items.filter((_, i) => i !== idx);

  return { lock: { ...lock, items }, removed };
}

/**
 * Get all lock entries matching a given type.
 */
export function getLockEntriesByType(lock: DotaiLockFile, type: ContextType): LockEntry[] {
  return lock.items.filter((item) => item.type === type);
}

/**
 * Get all lock entries installed from a given source.
 */
export function getLockEntriesBySource(lock: DotaiLockFile, source: string): LockEntry[] {
  return lock.items.filter((item) => item.source === source);
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 content hash for a raw content string.
 * Used for change detection in `dotai check` and `dotai update`.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty lock file at the current schema version.
 */
export function createEmptyLock(): DotaiLockFile {
  return { version: CURRENT_VERSION, items: [] };
}

/**
 * Get the current lock schema version.
 */
export function getCurrentVersion(): number {
  return CURRENT_VERSION;
}

// Re-export LockVersionError for use in tests and consumers
export { LockVersionError } from './lock-version-error.ts';

// ---------------------------------------------------------------------------
// Internal validation
// ---------------------------------------------------------------------------

const VALID_TYPES: ReadonlySet<string> = new Set(['skill', 'rule', 'prompt', 'agent']);
const VALID_AGENTS: ReadonlySet<string> = new Set([
  'github-copilot',
  'claude-code',
  'cursor',
  'windsurf',
  'cline',
  'opencode',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidContextFormat(value: unknown): value is ContextFormat {
  if (typeof value !== 'string') return false;
  if (value === 'canonical') return true;
  if (value.startsWith('native:')) {
    return VALID_AGENTS.has(value.slice(7));
  }
  return false;
}

function isValidLockEntry(value: unknown): value is LockEntry {
  if (!isPlainObject(value)) return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.type === 'string' &&
    VALID_TYPES.has(v.type) &&
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    typeof v.source === 'string' &&
    v.source.length > 0 &&
    isValidContextFormat(v.format) &&
    Array.isArray(v.agents) &&
    (v.agents as unknown[]).every((a) => typeof a === 'string' && VALID_AGENTS.has(a)) &&
    typeof v.hash === 'string' &&
    v.hash.length > 0 &&
    typeof v.installedAt === 'string' &&
    v.installedAt.length > 0 &&
    Array.isArray(v.outputs) &&
    (v.outputs as unknown[]).every((o) => typeof o === 'string') &&
    // Optional boolean fields — must be boolean if present
    (v.append === undefined || typeof v.append === 'boolean') &&
    (v.gitignored === undefined || typeof v.gitignored === 'boolean')
  );
}
