import { readFile, writeFile, readdir, rename } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';

import { LockVersionError } from './lock-version-error.ts';

const LOCAL_LOCK_FILE = 'skills-lock.json';
const CURRENT_VERSION = 1;

/**
 * Represents a single skill entry in the local (project) lock file.
 *
 * Intentionally minimal and timestamp-free to minimize merge conflicts.
 * Two branches adding different skills produce non-overlapping JSON keys
 * that git can auto-merge cleanly.
 */
export interface LocalSkillLockEntry {
  /** Where the skill came from: npm package name, owner/repo, local path, etc. */
  source: string;
  /** The provider/source type (e.g., "github", "node_modules", "local") */
  sourceType: string;
  /**
   * SHA-256 hash computed from all files in the skill folder.
   * Unlike the global lock which uses GitHub tree SHA, the local lock
   * computes the hash from actual file contents on disk.
   */
  computedHash: string;
}

/**
 * The structure of the local (project-scoped) skill lock file.
 * This file is meant to be checked into version control.
 *
 * Skills are sorted alphabetically by name when written to produce
 * deterministic output and minimize merge conflicts.
 */
export interface LocalSkillLockFile {
  /** Schema version — reject future versions, reset older ones. */
  version: number;
  /** Map of skill name to its lock entry (sorted alphabetically) */
  skills: Record<string, LocalSkillLockEntry>;
}

/**
 * Get the path to the local skill lock file for a project.
 */
export function getLocalLockPath(cwd?: string): string {
  return join(cwd || process.cwd(), LOCAL_LOCK_FILE);
}

/**
 * Read the local skill lock file.
 * Returns an empty lock file structure if the file doesn't exist
 * or is corrupted (e.g., merge conflict markers).
 * Resets to empty if the version is older than CURRENT_VERSION.
 * Throws `LockVersionError` if the lock file is from a future version.
 */
export async function readLocalLock(cwd?: string): Promise<LocalSkillLockFile> {
  const lockPath = getLocalLockPath(cwd);

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as LocalSkillLockFile;

    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return createEmptyLocalLock();
    }

    // Future version — reject with upgrade message
    if (parsed.version > CURRENT_VERSION) {
      throw new LockVersionError(parsed.version, CURRENT_VERSION, LOCAL_LOCK_FILE);
    }

    // Old version — wipe and start fresh
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLocalLock();
    }

    return parsed;
  } catch (error) {
    if (error instanceof LockVersionError) {
      throw error;
    }
    // File doesn't exist, is invalid JSON, or read error — return empty
    return createEmptyLocalLock();
  }
}

/**
 * Write the local skill lock file atomically.
 * Skills are sorted alphabetically by name for deterministic output.
 * Writes to a temp file first, then renames — prevents partial writes on failure.
 */
export async function writeLocalLock(lock: LocalSkillLockFile, cwd?: string): Promise<void> {
  const lockPath = getLocalLockPath(cwd);
  const tempPath = lockPath + '.tmp';

  // Sort skills alphabetically for deterministic output / clean diffs
  const sortedSkills: Record<string, LocalSkillLockEntry> = {};
  for (const key of Object.keys(lock.skills).sort()) {
    sortedSkills[key] = lock.skills[key]!;
  }

  const sorted: LocalSkillLockFile = { version: lock.version, skills: sortedSkills };
  const content = JSON.stringify(sorted, null, 2) + '\n';

  // Atomic write: write to temp, then rename
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, lockPath);
}

/**
 * Compute a SHA-256 hash from all files in a skill directory.
 * Reads all files recursively, sorts them by relative path for determinism,
 * and produces a single hash from their concatenated contents.
 */
export async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  await collectFiles(skillDir, skillDir, files);

  // Sort by relative path for deterministic hashing
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    // Include the path in the hash so renames are detected
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: Buffer }>
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip .git and node_modules within skill dirs
        if (entry.name === '.git' || entry.name === 'node_modules') return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split('\\').join('/');
        results.push({ relativePath, content });
      }
    })
  );
}

/**
 * Add or update a skill entry in the local lock file.
 */
export async function addSkillToLocalLock(
  skillName: string,
  entry: LocalSkillLockEntry,
  cwd?: string
): Promise<void> {
  const lock = await readLocalLock(cwd);
  lock.skills[skillName] = entry;
  await writeLocalLock(lock, cwd);
}

/**
 * Remove a skill from the local lock file.
 */
export async function removeSkillFromLocalLock(skillName: string, cwd?: string): Promise<boolean> {
  const lock = await readLocalLock(cwd);

  if (!(skillName in lock.skills)) {
    return false;
  }

  delete lock.skills[skillName];
  await writeLocalLock(lock, cwd);
  return true;
}

function createEmptyLocalLock(): LocalSkillLockFile {
  return {
    version: CURRENT_VERSION,
    skills: {},
  };
}
