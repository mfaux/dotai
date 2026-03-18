// ---------------------------------------------------------------------------
// .gitignore managed section for dotai
//
// Manages a `# dotai:start` / `# dotai:end` section in `.gitignore`.
// Enables adding and removing transpiled output paths without touching
// user-authored content.
//
// Reference: prd-gitignore-managed-output.md Task 2
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';

/** Opening marker for the dotai-managed section. */
const MARKER_START = '# dotai:start';

/** Closing marker for the dotai-managed section. */
const MARKER_END = '# dotai:end';

/**
 * Add paths to the dotai-managed section of `.gitignore`.
 *
 * - Creates the file if it doesn't exist.
 * - Creates the managed section if it doesn't exist.
 * - Deduplicates paths within the managed section.
 * - Paths are converted to project-root-relative format.
 */
export async function addToGitignore(projectRoot: string, absolutePaths: string[]): Promise<void> {
  if (absolutePaths.length === 0) return;

  const gitignorePath = join(projectRoot, '.gitignore');
  const relativePaths = absolutePaths.map((p) => toGitignorePath(projectRoot, p));

  let content = '';
  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8');
  }

  const existingPaths = parseManagedSection(content);
  const merged = deduplicatePaths([...existingPaths, ...relativePaths]);

  const updated = upsertManagedSection(content, merged);
  await writeFile(gitignorePath, updated, 'utf-8');
}

/**
 * Remove paths from the dotai-managed section of `.gitignore`.
 *
 * - Removes the managed section entirely if it becomes empty.
 * - No-op if the file or section doesn't exist.
 */
export async function removeFromGitignore(
  projectRoot: string,
  absolutePaths: string[]
): Promise<void> {
  if (absolutePaths.length === 0) return;

  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return;

  const content = await readFile(gitignorePath, 'utf-8');
  const existingPaths = parseManagedSection(content);
  if (existingPaths.length === 0) return;

  const toRemove = new Set(absolutePaths.map((p) => toGitignorePath(projectRoot, p)));
  const remaining = existingPaths.filter((p) => !toRemove.has(p));

  let updated: string;
  if (remaining.length === 0) {
    updated = removeManagedSection(content);
  } else {
    updated = upsertManagedSection(content, remaining);
  }

  await writeFile(gitignorePath, updated, 'utf-8');
}

/**
 * Read all paths currently in the dotai-managed section.
 *
 * Returns project-root-relative paths (e.g., `.cursor/rules/code-style.mdc`).
 * Returns an empty array if the file or section doesn't exist.
 */
export async function readManagedPaths(projectRoot: string): Promise<string[]> {
  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return [];

  const content = await readFile(gitignorePath, 'utf-8');
  return parseManagedSection(content);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert an absolute path to a `.gitignore`-style path relative to the
 * project root, using forward slashes.
 */
function toGitignorePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

/**
 * Deduplicate paths while preserving order.
 */
function deduplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result;
}

/**
 * Parse the dotai-managed section from `.gitignore` content.
 *
 * Returns the paths listed between the start and end markers,
 * filtering out empty lines and comment lines.
 */
function parseManagedSection(content: string): string[] {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return [];
  }

  const sectionBody = content.slice(startIdx + MARKER_START.length, endIdx);
  return sectionBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Insert or replace the dotai-managed section in `.gitignore` content.
 */
function upsertManagedSection(content: string, paths: string[]): string {
  const section = `${MARKER_START}\n${paths.join('\n')}\n${MARKER_END}`;

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + MARKER_END.length);
    return ensureTrailingNewline(before + section + after);
  }

  // Append at end
  const trimmed = content.replace(/\n+$/, '');
  if (trimmed.length === 0) {
    return section + '\n';
  }
  return trimmed + '\n\n' + section + '\n';
}

/**
 * Remove the dotai-managed section from `.gitignore` content.
 *
 * Cleans up surrounding blank lines to avoid excessive whitespace.
 */
function removeManagedSection(content: string): string {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return content;
  }

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + MARKER_END.length);

  const trimmedBefore = before.replace(/\n*$/, '');
  const trimmedAfter = after.replace(/^\n*/, '');

  if (trimmedBefore.length === 0 && trimmedAfter.length === 0) {
    return '';
  }
  if (trimmedBefore.length === 0) {
    return ensureTrailingNewline(trimmedAfter);
  }
  if (trimmedAfter.length === 0) {
    return ensureTrailingNewline(trimmedBefore);
  }

  return ensureTrailingNewline(trimmedBefore + '\n\n' + trimmedAfter);
}

function ensureTrailingNewline(s: string): string {
  if (s.length === 0) return s;
  return s.endsWith('\n') ? s : s + '\n';
}
