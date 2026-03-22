import matter from 'gray-matter';
import type { CanonicalAgent, AgentOverrideFields, TargetAgent } from './types.ts';
import {
  SUPPORTED_SCHEMA_VERSION,
  validateName,
  validateDescription,
  validateSchemaVersion,
} from './validation.ts';
import { extractOverrides } from './override-parser.ts';

// ---------------------------------------------------------------------------
// Agent-specific validation constants
// ---------------------------------------------------------------------------

/** Maximum length for the `model` field. */
const MAX_MODEL_LENGTH = 128;

/** Maximum number of tool entries. */
const MAX_TOOLS_COUNT = 50;

/** Maximum length for each individual tool name. */
const MAX_TOOL_LENGTH = 128;

/** Maximum number of disallowed-tool entries. */
const MAX_DISALLOWED_TOOLS_COUNT = 50;

/** Maximum value for max-turns. */
const MAX_TURNS_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result of parsing an AGENT.md file. */
export type ParseAgentResult =
  | { ok: true; agent: CanonicalAgent; warnings: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

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

function validateDisallowedTools(tools: unknown): string | null {
  if (tools === undefined || tools === null) {
    return null;
  }
  if (!Array.isArray(tools)) {
    return 'disallowed-tools must be an array of strings';
  }
  if (tools.length > MAX_DISALLOWED_TOOLS_COUNT) {
    return `disallowed-tools exceeds ${MAX_DISALLOWED_TOOLS_COUNT} entries`;
  }
  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    if (typeof entry !== 'string') {
      return `disallowed-tools[${i}] must be a string`;
    }
    if (entry.length > MAX_TOOL_LENGTH) {
      return `disallowed-tools[${i}] exceeds ${MAX_TOOL_LENGTH} characters`;
    }
  }
  return null;
}

function validateMaxTurns(maxTurns: unknown): string | null {
  if (maxTurns === undefined || maxTurns === null) {
    return null;
  }
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns)) {
    return 'max-turns must be a positive integer';
  }
  if (maxTurns < 1) {
    return 'max-turns must be a positive integer';
  }
  if (maxTurns > MAX_TURNS_LIMIT) {
    return `max-turns exceeds ${MAX_TURNS_LIMIT}`;
  }
  return null;
}

function validateBackground(background: unknown): string | null {
  if (background === undefined || background === null) {
    return null;
  }
  if (typeof background !== 'boolean') {
    return 'background must be a boolean';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Override support
// ---------------------------------------------------------------------------

/** Base field names recognized in AGENT.md frontmatter (not override blocks). */
const AGENT_BASE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'model',
  'tools',
  'disallowed-tools',
  'max-turns',
  'background',
  'schema-version',
]);

/** Fields that are not allowed in override blocks (identity / structural). */
const NON_OVERRIDABLE_AGENT_FIELDS: ReadonlySet<string> = new Set(['name', 'body', 'raw']);

/**
 * Extract and validate agent override fields from an agent override block.
 *
 * Agent-exclusive fields (disallowedTools, maxTurns, background) are valid
 * in any agent's override block. The transpiler will ignore unsupported
 * fields as it does today.
 */
function extractAgentOverrideFields(
  agentData: Record<string, unknown>,
  _agentName: TargetAgent
): { fields: AgentOverrideFields; error: string | null } {
  const fields: AgentOverrideFields = {};

  for (const key of Object.keys(agentData)) {
    if (NON_OVERRIDABLE_AGENT_FIELDS.has(key)) {
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

  if ('model' in agentData) {
    const err = validateModel(agentData.model);
    if (err) return { fields, error: err };
    fields.model = agentData.model as string;
  }

  if ('tools' in agentData) {
    const err = validateTools(agentData.tools);
    if (err) return { fields, error: err };
    fields.tools = Array.isArray(agentData.tools) ? (agentData.tools as string[]) : undefined;
  }

  if ('disallowed-tools' in agentData) {
    const err = validateDisallowedTools(agentData['disallowed-tools']);
    if (err) return { fields, error: err };
    fields.disallowedTools = Array.isArray(agentData['disallowed-tools'])
      ? (agentData['disallowed-tools'] as string[])
      : undefined;
  }

  if ('max-turns' in agentData) {
    const err = validateMaxTurns(agentData['max-turns']);
    if (err) return { fields, error: err };
    fields.maxTurns = agentData['max-turns'] as number;
  }

  if ('background' in agentData) {
    const err = validateBackground(agentData.background);
    if (err) return { fields, error: err };
    fields.background = agentData.background as boolean;
  }

  return { fields, error: null };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate an AGENT.md file from its raw content string.
 *
 * Returns a discriminated union: `{ ok: true, agent }` on success,
 * `{ ok: false, error }` on validation failure.
 */
export function parseAgentContent(content: string): ParseAgentResult {
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
  const nameError = validateName(data.name, 'my-agent');
  if (nameError) return { ok: false, error: nameError };

  const descriptionError = validateDescription(data.description);
  if (descriptionError) return { ok: false, error: descriptionError };

  const modelError = validateModel(data.model);
  if (modelError) return { ok: false, error: modelError };

  const toolsError = validateTools(data.tools);
  if (toolsError) return { ok: false, error: toolsError };

  const disallowedToolsError = validateDisallowedTools(data['disallowed-tools']);
  if (disallowedToolsError) return { ok: false, error: disallowedToolsError };

  const maxTurnsError = validateMaxTurns(data['max-turns']);
  if (maxTurnsError) return { ok: false, error: maxTurnsError };

  const backgroundError = validateBackground(data.background);
  if (backgroundError) return { ok: false, error: backgroundError };

  const schemaVersionRaw = data['schema-version'];
  const versionError = validateSchemaVersion(schemaVersionRaw);
  if (versionError) return { ok: false, error: versionError };

  // Extract per-agent overrides
  const { overrides, warnings } = extractOverrides<AgentOverrideFields>(
    data,
    AGENT_BASE_FIELDS,
    extractAgentOverrideFields
  );

  const agent: CanonicalAgent = {
    name: data.name as string,
    description: data.description as string,
    body: body.trim(),
    raw: content,
  };

  if (data.model !== undefined && data.model !== null) {
    agent.model = data.model as string;
  }

  if (Array.isArray(data.tools)) {
    agent.tools = data.tools as string[];
  }

  if (Array.isArray(data['disallowed-tools'])) {
    agent.disallowedTools = data['disallowed-tools'] as string[];
  }

  if (typeof data['max-turns'] === 'number') {
    agent.maxTurns = data['max-turns'] as number;
  }

  if (typeof data.background === 'boolean') {
    agent.background = data.background as boolean;
  }

  if (overrides) {
    agent.overrides = overrides;
  }

  return { ok: true, agent, warnings };
}
