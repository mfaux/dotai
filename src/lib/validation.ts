// ---------------------------------------------------------------------------
// Shared validation constants and helpers for rule, prompt, and agent parsers
// ---------------------------------------------------------------------------

/** Maximum length for the `name` field (kebab-case identifier). */
const MAX_NAME_LENGTH = 128;

/** Maximum length for the `description` field. */
const MAX_DESCRIPTION_LENGTH = 512;

/** Pattern for valid kebab-case names: lowercase alphanumeric + hyphens. */
export const KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The only schema version we currently support. */
export const SUPPORTED_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a kebab-case `name` field.
 *
 * @param name - The value to validate.
 * @param example - An example name to show in error messages (e.g. "code-style").
 * @returns An error message string, or `null` if valid.
 */
export function validateName(name: unknown, example: string = 'my-name'): string | null {
  if (name === undefined || name === null) {
    return 'missing required field: name';
  }
  if (typeof name !== 'string') {
    return 'name must be a string';
  }
  if (name.length === 0) {
    return 'name must not be empty';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `name exceeds ${MAX_NAME_LENGTH} characters`;
  }
  if (!KEBAB_CASE_PATTERN.test(name)) {
    return `name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "${example}")`;
  }
  return null;
}

/**
 * Validate a `description` field.
 *
 * @returns An error message string, or `null` if valid.
 */
export function validateDescription(description: unknown): string | null {
  if (description === undefined || description === null) {
    return 'missing required field: description';
  }
  if (typeof description !== 'string') {
    return 'description must be a string';
  }
  if (description.length === 0) {
    return 'description must not be empty';
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `description exceeds ${MAX_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

/**
 * Validate an optional `schema-version` field.
 *
 * @returns An error message string, or `null` if valid.
 */
export function validateSchemaVersion(version: unknown): string | null {
  if (version === undefined || version === null) {
    // Optional — will default to 1.
    return null;
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return 'schema-version must be an integer';
  }
  if (version > SUPPORTED_SCHEMA_VERSION) {
    return `unsupported schema-version ${version} (this version of dotai supports schema-version ${SUPPORTED_SCHEMA_VERSION}). Please upgrade dotai.`;
  }
  if (version < 1) {
    return 'schema-version must be >= 1';
  }
  return null;
}
