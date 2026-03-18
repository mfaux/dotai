// ---------------------------------------------------------------------------
// Marker management for append-mode rule transpilation
//
// Manages `<!-- dotai:<name>:start -->` / `<!-- dotai:<name>:end -->` sections
// in markdown files (AGENTS.md, CLAUDE.md). Enables clean insert, update, and
// remove of rule content without touching user-authored content.
//
// Reference: prd-rule-append-fallback.md Task 1
// ---------------------------------------------------------------------------

/**
 * Build the opening marker for a named section.
 */
function startMarker(name: string): string {
  return `<!-- dotai:${name}:start -->`;
}

/**
 * Build the closing marker for a named section.
 */
function endMarker(name: string): string {
  return `<!-- dotai:${name}:end -->`;
}

/**
 * Insert or replace a named section in a markdown file.
 *
 * If the section already exists (matching start/end markers), the content
 * between the markers is replaced. If the section does not exist, it is
 * appended at the end of the file.
 *
 * The output always has a trailing newline.
 */
export function upsertSection(content: string, name: string, body: string): string {
  const start = startMarker(name);
  const end = endMarker(name);
  const section = `${start}\n${body}\n${end}`;

  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section (markers + content between them)
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + end.length);
    const result = before + section + after;
    return ensureTrailingNewline(result);
  }

  // Append at end
  const trimmed = content.replace(/\n+$/, '');
  if (trimmed.length === 0) {
    return section + '\n';
  }
  return trimmed + '\n\n' + section + '\n';
}

/**
 * Remove a named section from a markdown file.
 *
 * Removes the start marker, end marker, all content between them, and any
 * surrounding blank lines that would result in excessive whitespace.
 *
 * Returns the content unchanged if no matching section is found.
 */
export function removeSection(content: string, name: string): string {
  const start = startMarker(name);
  const end = endMarker(name);

  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return content;
  }

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + end.length);

  // Clean up surrounding blank lines:
  // - Trim trailing whitespace/newlines from before
  // - Trim leading whitespace/newlines from after
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

/**
 * Check if a named section exists in a markdown file.
 */
export function hasSection(content: string, name: string): boolean {
  const start = startMarker(name);
  const end = endMarker(name);

  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  return startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;
}

/**
 * Extract the content of a named section (between markers, excluding markers).
 *
 * Returns `null` if the section is not found.
 */
export function extractSection(content: string, name: string): string | null {
  const start = startMarker(name);
  const end = endMarker(name);

  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  const bodyStart = startIdx + start.length;
  const body = content.slice(bodyStart, endIdx);

  // Strip exactly one leading and one trailing newline if present
  // (these are the newlines we add around the body in upsertSection)
  return body.replace(/^\n/, '').replace(/\n$/, '');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureTrailingNewline(s: string): string {
  if (s.length === 0) return s;
  return s.endsWith('\n') ? s : s + '\n';
}
