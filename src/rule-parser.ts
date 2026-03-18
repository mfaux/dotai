import matter from 'gray-matter';
import type { CanonicalRule, RuleActivation } from './types.ts';
import {
  SUPPORTED_SCHEMA_VERSION,
  validateName,
  validateDescription,
  validateSchemaVersion,
} from './validation.ts';

// ---------------------------------------------------------------------------
// Rule-specific validation constants
// ---------------------------------------------------------------------------

/** Maximum number of glob entries. */
const MAX_GLOBS_COUNT = 50;

/** Maximum length for each individual glob pattern. */
const MAX_GLOB_LENGTH = 256;

/** Valid activation values. */
const VALID_ACTIVATIONS: readonly RuleActivation[] = ['always', 'auto', 'manual', 'glob'] as const;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Result of parsing a RULES.md file. */
export type ParseRuleResult = { ok: true; rule: CanonicalRule } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateGlobs(globs: unknown): string | null {
  if (globs === undefined || globs === null) {
    // Globs are optional — will default to empty array.
    return null;
  }
  if (!Array.isArray(globs)) {
    return 'globs must be an array of strings';
  }
  if (globs.length > MAX_GLOBS_COUNT) {
    return `globs exceeds ${MAX_GLOBS_COUNT} entries`;
  }
  for (let i = 0; i < globs.length; i++) {
    const entry = globs[i];
    if (typeof entry !== 'string') {
      return `globs[${i}] must be a string`;
    }
    if (entry.length > MAX_GLOB_LENGTH) {
      return `globs[${i}] exceeds ${MAX_GLOB_LENGTH} characters`;
    }
  }
  return null;
}

function validateActivation(activation: unknown): string | null {
  if (activation === undefined || activation === null) {
    // Optional — will default to 'always'.
    return null;
  }
  if (typeof activation !== 'string') {
    return 'activation must be a string';
  }
  if (!VALID_ACTIVATIONS.includes(activation as RuleActivation)) {
    return `activation must be one of: ${VALID_ACTIVATIONS.join(', ')}`;
  }
  return null;
}

function validateSeverity(severity: unknown): string | null {
  if (severity === undefined || severity === null) {
    return null;
  }
  if (typeof severity !== 'string') {
    return 'severity must be a string';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a RULES.md file from its raw content string.
 *
 * Returns a discriminated union: `{ ok: true, rule }` on success,
 * `{ ok: false, error }` on validation failure.
 */
export function parseRuleContent(content: string): ParseRuleResult {
  let data: Record<string, unknown>;
  let body: string;
  try {
    const parsed = matter(content);
    data = parsed.data;
    body = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `invalid YAML frontmatter: ${message}` };
  }

  // Validate each field, collecting the first error.
  const nameError = validateName(data.name, 'code-style');
  if (nameError) return { ok: false, error: nameError };

  const descriptionError = validateDescription(data.description);
  if (descriptionError) return { ok: false, error: descriptionError };

  const globsError = validateGlobs(data.globs);
  if (globsError) return { ok: false, error: globsError };

  const activationError = validateActivation(data.activation);
  if (activationError) return { ok: false, error: activationError };

  const severityError = validateSeverity(data.severity);
  if (severityError) return { ok: false, error: severityError };

  const schemaVersionRaw = data['schema-version'];
  const versionError = validateSchemaVersion(schemaVersionRaw);
  if (versionError) return { ok: false, error: versionError };

  const rule: CanonicalRule = {
    name: data.name as string,
    description: data.description as string,
    globs: Array.isArray(data.globs) ? (data.globs as string[]) : [],
    activation: (data.activation as RuleActivation) ?? 'always',
    schemaVersion:
      typeof schemaVersionRaw === 'number' ? schemaVersionRaw : SUPPORTED_SCHEMA_VERSION,
    body: body.trim(),
  };

  if (data.severity !== undefined && data.severity !== null) {
    rule.severity = data.severity as string;
  }

  return { ok: true, rule };
}
