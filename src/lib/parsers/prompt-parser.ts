import matter from 'gray-matter';
import type { CanonicalPrompt, PromptOverrideFields, TargetAgent } from '../types.ts';
import {
  SUPPORTED_SCHEMA_VERSION,
  validateName,
  validateDescription,
  validateSchemaVersion,
} from '../validation.ts';
import { extractOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Prompt-specific validation constants
// ---------------------------------------------------------------------------

/** Maximum length for the `argument-hint` field. */
const MAX_ARGUMENT_HINT_LENGTH = 256;

/** Maximum length for the `agent` field. */
const MAX_AGENT_LENGTH = 128;

/** Maximum length for the `model` field. */
const MAX_MODEL_LENGTH = 128;

/** Maximum number of tool entries. */
const MAX_TOOLS_COUNT = 50;

/** Maximum length for each individual tool name. */
const MAX_TOOL_LENGTH = 128;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result of parsing a PROMPT.md file. */
export type ParsePromptResult =
  | { ok: true; prompt: CanonicalPrompt; warnings: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateArgumentHint(argumentHint: unknown): string | null {
  if (argumentHint === undefined || argumentHint === null) {
    return null;
  }
  if (typeof argumentHint !== 'string') {
    return 'argument-hint must be a string';
  }
  if (argumentHint.length > MAX_ARGUMENT_HINT_LENGTH) {
    return `argument-hint exceeds ${MAX_ARGUMENT_HINT_LENGTH} characters`;
  }
  return null;
}

function validateAgent(agent: unknown): string | null {
  if (agent === undefined || agent === null) {
    return null;
  }
  if (typeof agent !== 'string') {
    return 'agent must be a string';
  }
  if (agent.length > MAX_AGENT_LENGTH) {
    return `agent exceeds ${MAX_AGENT_LENGTH} characters`;
  }
  return null;
}

function validateModel(model: unknown): string | null {
  if (model === undefined || model === null) {
    return null;
  }
  if (typeof model !== 'string') {
    return 'model must be a string';
  }
  if (model.length > MAX_MODEL_LENGTH) {
    return `model exceeds ${MAX_MODEL_LENGTH} characters`;
  }
  return null;
}

function validateTools(tools: unknown): string | null {
  if (tools === undefined || tools === null) {
    // Tools are optional — will default to empty array.
    return null;
  }
  if (!Array.isArray(tools)) {
    return 'tools must be an array of strings';
  }
  if (tools.length > MAX_TOOLS_COUNT) {
    return `tools exceeds ${MAX_TOOLS_COUNT} entries`;
  }
  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    if (typeof entry !== 'string') {
      return `tools[${i}] must be a string`;
    }
    if (entry.length > MAX_TOOL_LENGTH) {
      return `tools[${i}] exceeds ${MAX_TOOL_LENGTH} characters`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Override support
// ---------------------------------------------------------------------------

/** Base field names recognized in PROMPT.md frontmatter (not override blocks). */
const PROMPT_BASE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'argument-hint',
  'agent',
  'model',
  'tools',
  'schema-version',
]);

/** Fields that are not allowed in override blocks (identity / structural). */
const NON_OVERRIDABLE_PROMPT_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'schema-version',
  'body',
]);

/**
 * Extract and validate prompt override fields from an agent override block.
 */
function extractPromptOverrideFields(
  agentData: Record<string, unknown>,
  _agentName: TargetAgent
): { fields: PromptOverrideFields; error: string | null } {
  const fields: PromptOverrideFields = {};

  for (const key of Object.keys(agentData)) {
    if (NON_OVERRIDABLE_PROMPT_FIELDS.has(key)) {
      // Silently ignore non-overridable fields
      continue;
    }
  }

  // Validate and extract each overridable field
  if ('description' in agentData) {
    const err = validateDescription(agentData.description);
    if (err) return { fields, error: err };
    fields.description = agentData.description as string;
  }

  if ('argument-hint' in agentData) {
    const err = validateArgumentHint(agentData['argument-hint']);
    if (err) return { fields, error: err };
    fields.argumentHint = agentData['argument-hint'] as string;
  }

  if ('agent' in agentData) {
    const err = validateAgent(agentData.agent);
    if (err) return { fields, error: err };
    fields.agent = agentData.agent as string;
  }

  if ('model' in agentData) {
    const err = validateModel(agentData.model);
    if (err) return { fields, error: err };
    fields.model = agentData.model as string;
  }

  if ('tools' in agentData) {
    const err = validateTools(agentData.tools);
    if (err) return { fields, error: err };
    fields.tools = Array.isArray(agentData.tools) ? (agentData.tools as string[]) : [];
  }

  return { fields, error: null };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a PROMPT.md file from its raw content string.
 *
 * Returns a discriminated union: `{ ok: true, prompt, warnings }` on success,
 * `{ ok: false, error }` on validation failure.
 */
export function parsePromptContent(content: string): ParsePromptResult {
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
  const nameError = validateName(data.name, 'review-code');
  if (nameError) return { ok: false, error: nameError };

  const descriptionError = validateDescription(data.description);
  if (descriptionError) return { ok: false, error: descriptionError };

  const argumentHintError = validateArgumentHint(data['argument-hint']);
  if (argumentHintError) return { ok: false, error: argumentHintError };

  const agentError = validateAgent(data.agent);
  if (agentError) return { ok: false, error: agentError };

  const modelError = validateModel(data.model);
  if (modelError) return { ok: false, error: modelError };

  const toolsError = validateTools(data.tools);
  if (toolsError) return { ok: false, error: toolsError };

  const schemaVersionRaw = data['schema-version'];
  const versionError = validateSchemaVersion(schemaVersionRaw);
  if (versionError) return { ok: false, error: versionError };

  // Extract per-agent overrides
  const { overrides, warnings } = extractOverrides<PromptOverrideFields>(
    data,
    PROMPT_BASE_FIELDS,
    extractPromptOverrideFields
  );

  const prompt: CanonicalPrompt = {
    name: data.name as string,
    description: data.description as string,
    tools: Array.isArray(data.tools) ? (data.tools as string[]) : [],
    schemaVersion:
      typeof schemaVersionRaw === 'number' ? schemaVersionRaw : SUPPORTED_SCHEMA_VERSION,
    body: body.trim(),
  };

  if (data['argument-hint'] !== undefined && data['argument-hint'] !== null) {
    prompt.argumentHint = data['argument-hint'] as string;
  }

  if (data.agent !== undefined && data.agent !== null) {
    prompt.agent = data.agent as string;
  }

  if (data.model !== undefined && data.model !== null) {
    prompt.model = data.model as string;
  }

  if (overrides) {
    prompt.overrides = overrides;
  }

  return { ok: true, prompt, warnings };
}
