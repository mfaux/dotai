import matter from 'gray-matter';
import type { CanonicalPrompt } from './types.ts';
import {
  SUPPORTED_SCHEMA_VERSION,
  validateName,
  validateDescription,
  validateSchemaVersion,
} from './validation.ts';

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
  | { ok: true; prompt: CanonicalPrompt }
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
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a PROMPT.md file from its raw content string.
 *
 * Returns a discriminated union: `{ ok: true, prompt }` on success,
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

  return { ok: true, prompt };
}
