import matter from 'gray-matter';
import type { CanonicalInstruction, InstructionOverrideFields, TargetAgent } from '../../types.ts';
import {
  SUPPORTED_SCHEMA_VERSION,
  validateName,
  validateDescription,
  validateSchemaVersion,
} from '../../validation.ts';
import { extractOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result of parsing an INSTRUCTIONS.md file. */
export type ParseInstructionResult =
  | { ok: true; instruction: CanonicalInstruction; warnings: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Override support
// ---------------------------------------------------------------------------

/** Base field names recognized in INSTRUCTIONS.md frontmatter (not override blocks). */
const INSTRUCTION_BASE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'schema-version',
]);

/** Fields that are not allowed in override blocks (identity / structural). */
const NON_OVERRIDABLE_INSTRUCTION_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'schema-version',
  'body',
]);

/**
 * Extract and validate instruction override fields from an agent override block.
 * Instructions only support description overrides.
 */
function extractInstructionOverrideFields(
  agentData: Record<string, unknown>,
  _agentName: TargetAgent
): { fields: InstructionOverrideFields; error: string | null } {
  const fields: InstructionOverrideFields = {};

  for (const key of Object.keys(agentData)) {
    if (NON_OVERRIDABLE_INSTRUCTION_FIELDS.has(key)) {
      // Silently ignore non-overridable fields
      continue;
    }
  }

  if ('description' in agentData) {
    const err = validateDescription(agentData.description);
    if (err) return { fields, error: err };
    fields.description = agentData.description as string;
  }

  return { fields, error: null };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate an INSTRUCTIONS.md file from its raw content string.
 *
 * Returns a discriminated union: `{ ok: true, instruction, warnings }` on
 * success, `{ ok: false, error }` on validation failure.
 */
export function parseInstructionContent(content: string): ParseInstructionResult {
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

  // Validate required fields.
  const nameError = validateName(data.name, 'my-instruction');
  if (nameError) return { ok: false, error: nameError };

  const descriptionError = validateDescription(data.description);
  if (descriptionError) return { ok: false, error: descriptionError };

  const schemaVersionRaw = data['schema-version'];
  const versionError = validateSchemaVersion(schemaVersionRaw);
  if (versionError) return { ok: false, error: versionError };

  // Extract per-agent overrides
  const { overrides, warnings } = extractOverrides<InstructionOverrideFields>(
    data,
    INSTRUCTION_BASE_FIELDS,
    extractInstructionOverrideFields
  );

  const instruction: CanonicalInstruction = {
    name: data.name as string,
    description: data.description as string,
    schemaVersion:
      typeof schemaVersionRaw === 'number' ? schemaVersionRaw : SUPPORTED_SCHEMA_VERSION,
    body: body.trim(),
  };

  if (overrides) {
    instruction.overrides = overrides;
  }

  return { ok: true, instruction, warnings };
}
