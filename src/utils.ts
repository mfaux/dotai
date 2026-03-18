import { homedir } from 'os';

// ---------------------------------------------------------------------------
// ANSI color constants
// ---------------------------------------------------------------------------

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
/** Darker gray for secondary text (256-color). */
export const DIM = '\x1b[38;5;102m';
/** Lighter gray for primary text (256-color). */
export const TEXT = '\x1b[38;5;145m';
export const CYAN = '\x1b[36m';
export const YELLOW = '\x1b[33m';
export const MAGENTA = '\x1b[35m';

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 * Handles both Unix and Windows path separators.
 */
export function shortenPath(fullPath: string, cwd: string): string {
  const normalizedPath = normalizeDisplayPath(fullPath);
  const normalizedHome = normalizeDisplayPath(homedir());
  const normalizedCwd = normalizeDisplayPath(cwd);

  if (normalizedPath === normalizedHome || normalizedPath.startsWith(normalizedHome + '/')) {
    return '~' + normalizedPath.slice(normalizedHome.length);
  }

  if (normalizedPath === normalizedCwd || normalizedPath.startsWith(normalizedCwd + '/')) {
    return '.' + normalizedPath.slice(normalizedCwd.length);
  }

  return fullPath;
}

function normalizeDisplayPath(path: string): string {
  if (path.length === 0) return path;

  const normalized = path.replace(/\\/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.replace(/\/+$/, '');
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Formats a list of items, truncating with "+N more" if too many.
 */
export function formatList(items: string[], maxShow: number = 5): string {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

/**
 * Converts a kebab-case string to Title Case.
 * e.g. "my-cool-plugin" → "My Cool Plugin"
 */
export function kebabToTitle(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
