import { readdir, readFile, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { parseAgentContent } from './agent-parser.ts';
import { parseInstructionContent } from './instruction-parser.ts';
import { parsePromptContent } from './prompt-parser.ts';
import { parseRuleContent } from './rule-parser.ts';
import { targetAgents } from './target-agents.ts';
import type { ContextFormat, ContextType, DiscoveredItem, TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Discovery constants
// ---------------------------------------------------------------------------

/** All context types, used as default when no type filter is provided. */
const ALL_TYPES: readonly ContextType[] = [
  'skill',
  'rule',
  'prompt',
  'agent',
  'instruction',
] as const;

/** Maximum number of discovered items per context type. */
const MAX_ITEMS_PER_TYPE = 500;

/** Maximum file size (bytes) for canonical files. */
const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB

/** Directories to skip during recursive search. */
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
  /** Context types to discover. Omit or pass empty to discover all types. */
  types?: ContextType[];
  /** Maximum items per context type (default: 500). */
  maxItemsPerType?: number;
  /** Maximum file size in bytes (default: 100KB). */
  maxFileSize?: number;
}

// ---------------------------------------------------------------------------
// Discovery warnings
// ---------------------------------------------------------------------------

export interface DiscoveryWarning {
  type: 'cap-reached' | 'file-too-large' | 'parse-error';
  message: string;
  path?: string;
}

export interface DiscoveryResult {
  items: DiscoveredItem[];
  warnings: DiscoveryWarning[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function safeReadFile(
  path: string,
  maxSize: number
): Promise<{ content: string } | { error: string }> {
  try {
    const s = await stat(path);
    if (s.size > maxSize) {
      return { error: `file exceeds ${maxSize} bytes (${s.size} bytes)` };
    }
    const content = await readFile(path, 'utf-8');
    return { content };
  } catch {
    return { error: `failed to read file` };
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !SKIP_DIRS.includes(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if a resolved path is within the expected base directory.
 * Prevents symlink traversal attacks.
 */
function isWithinBase(filePath: string, basePath: string): boolean {
  const resolved = resolve(filePath);
  const base = resolve(basePath);
  return resolved.startsWith(base + sep) || resolved === base;
}

/**
 * Match a filename against a simple glob pattern (e.g. "*.md", "*.mdc").
 * Only supports `*` prefix matching — sufficient for our native rule patterns.
 */
function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1));
  }
  return filename === pattern;
}

// ---------------------------------------------------------------------------
// Canonical RULES.md discovery
// ---------------------------------------------------------------------------

async function discoverCanonicalRules(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenNames = new Set<string>();

  async function tryAddRule(filePath: string): Promise<boolean> {
    if (items.length >= maxItems) {
      return false; // Cap reached — caller will add warning
    }
    if (!isWithinBase(filePath, basePath)) {
      return false;
    }
    const result = await safeReadFile(filePath, maxFileSize);
    if ('error' in result) {
      warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
      return false;
    }

    const parsed = parseRuleContent(result.content);
    if (!parsed.ok) {
      warnings.push({ type: 'parse-error', message: parsed.error, path: filePath });
      return false;
    }

    if (seenNames.has(parsed.rule.name)) {
      return false; // Duplicate name — first one wins
    }

    seenNames.add(parsed.rule.name);
    items.push({
      type: 'rule',
      format: 'canonical',
      name: parsed.rule.name,
      description: parsed.rule.description,
      sourcePath: filePath,
      rawContent: result.content,
    });
    return true;
  }

  // 1. Root RULES.md
  const rootRulesPath = join(basePath, 'RULES.md');
  if (await fileExists(rootRulesPath)) {
    await tryAddRule(rootRulesPath);
  }

  // 2. rules/*/RULES.md
  const rulesDir = join(basePath, 'rules');
  const ruleDirs = await listDirs(rulesDir);
  for (const dir of ruleDirs) {
    if (items.length >= maxItems) {
      warnings.push({
        type: 'cap-reached',
        message: `discovery capped at ${maxItems} rules`,
      });
      break;
    }
    const ruleFile = join(rulesDir, dir, 'RULES.md');
    if (await fileExists(ruleFile)) {
      await tryAddRule(ruleFile);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Canonical PROMPT.md discovery
// ---------------------------------------------------------------------------

async function discoverCanonicalPrompts(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenNames = new Set<string>();

  async function tryAddPrompt(filePath: string): Promise<boolean> {
    if (items.length >= maxItems) {
      return false; // Cap reached — caller will add warning
    }
    if (!isWithinBase(filePath, basePath)) {
      return false;
    }
    const result = await safeReadFile(filePath, maxFileSize);
    if ('error' in result) {
      warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
      return false;
    }

    const parsed = parsePromptContent(result.content);
    if (!parsed.ok) {
      warnings.push({ type: 'parse-error', message: parsed.error, path: filePath });
      return false;
    }

    if (seenNames.has(parsed.prompt.name)) {
      return false; // Duplicate name — first one wins
    }

    seenNames.add(parsed.prompt.name);
    items.push({
      type: 'prompt',
      format: 'canonical',
      name: parsed.prompt.name,
      description: parsed.prompt.description,
      sourcePath: filePath,
      rawContent: result.content,
    });
    return true;
  }

  // 1. Root PROMPT.md
  const rootPromptPath = join(basePath, 'PROMPT.md');
  if (await fileExists(rootPromptPath)) {
    await tryAddPrompt(rootPromptPath);
  }

  // 2. prompts/*/PROMPT.md
  const promptsDir = join(basePath, 'prompts');
  const promptDirs = await listDirs(promptsDir);
  for (const dir of promptDirs) {
    if (items.length >= maxItems) {
      warnings.push({
        type: 'cap-reached',
        message: `discovery capped at ${maxItems} prompts`,
      });
      break;
    }
    const promptFile = join(promptsDir, dir, 'PROMPT.md');
    if (await fileExists(promptFile)) {
      await tryAddPrompt(promptFile);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Canonical AGENT.md discovery
// ---------------------------------------------------------------------------

async function discoverCanonicalAgents(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenNames = new Set<string>();

  async function tryAddAgent(filePath: string): Promise<boolean> {
    if (items.length >= maxItems) {
      return false; // Cap reached — caller will add warning
    }
    if (!isWithinBase(filePath, basePath)) {
      return false;
    }
    const result = await safeReadFile(filePath, maxFileSize);
    if ('error' in result) {
      warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
      return false;
    }

    const parsed = parseAgentContent(result.content);
    if (!parsed.ok) {
      warnings.push({ type: 'parse-error', message: parsed.error, path: filePath });
      return false;
    }

    if (seenNames.has(parsed.agent.name)) {
      return false; // Duplicate name — first one wins
    }

    seenNames.add(parsed.agent.name);
    items.push({
      type: 'agent',
      format: 'canonical',
      name: parsed.agent.name,
      description: parsed.agent.description,
      sourcePath: filePath,
      rawContent: result.content,
    });
    return true;
  }

  // 1. Root AGENT.md
  const rootAgentPath = join(basePath, 'AGENT.md');
  if (await fileExists(rootAgentPath)) {
    await tryAddAgent(rootAgentPath);
  }

  // 2. agents/*/AGENT.md
  const agentsDir = join(basePath, 'agents');
  const agentDirs = await listDirs(agentsDir);
  for (const dir of agentDirs) {
    if (items.length >= maxItems) {
      warnings.push({
        type: 'cap-reached',
        message: `discovery capped at ${maxItems} agents`,
      });
      break;
    }
    const agentFile = join(agentsDir, dir, 'AGENT.md');
    if (await fileExists(agentFile)) {
      await tryAddAgent(agentFile);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Canonical SKILL.md discovery
// ---------------------------------------------------------------------------

async function discoverCanonicalSkills(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenNames = new Set<string>();

  async function tryAddSkill(filePath: string): Promise<boolean> {
    if (items.length >= maxItems) {
      return false;
    }
    if (!isWithinBase(filePath, basePath)) {
      return false;
    }
    const result = await safeReadFile(filePath, maxFileSize);
    if ('error' in result) {
      warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
      return false;
    }

    // Parse SKILL.md frontmatter (name + description required)
    // We use a lightweight inline parse here since we only need name/description
    // for the DiscoveredItem — full skill handling is done by the existing
    // skills.ts module during installation.
    let name: string | undefined;
    let description: string | undefined;
    try {
      const matter = (await import('gray-matter')).default;
      const { data } = matter(result.content);
      if (typeof data.name === 'string') name = data.name;
      if (typeof data.description === 'string') description = data.description;
    } catch {
      warnings.push({
        type: 'parse-error',
        message: 'invalid SKILL.md frontmatter',
        path: filePath,
      });
      return false;
    }

    if (!name || !description) {
      warnings.push({
        type: 'parse-error',
        message: 'SKILL.md missing required name or description',
        path: filePath,
      });
      return false;
    }

    if (seenNames.has(name)) {
      return false;
    }

    seenNames.add(name);
    items.push({
      type: 'skill',
      format: 'canonical',
      name,
      description,
      sourcePath: filePath,
      rawContent: result.content,
    });
    return true;
  }

  // 1. Root SKILL.md
  const rootSkillPath = join(basePath, 'SKILL.md');
  if (await fileExists(rootSkillPath)) {
    await tryAddSkill(rootSkillPath);
  }

  // 2. skills/*/SKILL.md
  const skillsDir = join(basePath, 'skills');
  const skillDirs = await listDirs(skillsDir);
  for (const dir of skillDirs) {
    if (items.length >= maxItems) {
      warnings.push({
        type: 'cap-reached',
        message: `discovery capped at ${maxItems} skills`,
      });
      break;
    }
    const skillFile = join(skillsDir, dir, 'SKILL.md');
    if (await fileExists(skillFile)) {
      await tryAddSkill(skillFile);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Canonical INSTRUCTIONS.md discovery (root-only)
// ---------------------------------------------------------------------------

async function discoverCanonicalInstructions(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];

  // Only root-level INSTRUCTIONS.md — no subdirectory scanning
  const rootInstructionPath = join(basePath, 'INSTRUCTIONS.md');
  if (!(await fileExists(rootInstructionPath))) {
    return items;
  }
  if (!isWithinBase(rootInstructionPath, basePath)) {
    return items;
  }

  const result = await safeReadFile(rootInstructionPath, maxFileSize);
  if ('error' in result) {
    warnings.push({ type: 'file-too-large', message: result.error, path: rootInstructionPath });
    return items;
  }

  const parsed = parseInstructionContent(result.content);
  if (!parsed.ok) {
    warnings.push({ type: 'parse-error', message: parsed.error, path: rootInstructionPath });
    return items;
  }

  items.push({
    type: 'instruction',
    format: 'canonical',
    name: parsed.instruction.name,
    description: parsed.instruction.description,
    sourcePath: rootInstructionPath,
    rawContent: result.content,
  });

  return items;
}

// ---------------------------------------------------------------------------
// Native passthrough rules discovery
// ---------------------------------------------------------------------------

/**
 * Derive a kebab-case name from a native rule filename.
 * Strips the agent-specific extension and returns the base name.
 *
 * Examples:
 *   "code-style.mdc" -> "code-style"
 *   "code-style.instructions.md" -> "code-style"
 *   "code-style.md" -> "code-style"
 */
function deriveNameFromFilename(filename: string, extension: string): string {
  if (filename.endsWith(extension)) {
    return filename.slice(0, -extension.length);
  }
  // Fallback: strip last extension
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

async function discoverNativeRules(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  existingCount: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenPaths = new Set<string>();
  let totalCount = existingCount;

  for (const [agentName, config] of Object.entries(targetAgents)) {
    const agent = agentName as TargetAgent;
    const { sourceDir, pattern } = config.nativeRuleDiscovery;
    const searchDir = join(basePath, sourceDir);

    const files = await listFiles(searchDir);
    for (const file of files) {
      if (totalCount + items.length >= maxItems) {
        warnings.push({
          type: 'cap-reached',
          message: `discovery capped at ${maxItems} rules (including native)`,
        });
        return items;
      }

      if (!matchesPattern(file, pattern)) {
        continue;
      }

      const filePath = join(searchDir, file);
      if (seenPaths.has(filePath) || !isWithinBase(filePath, basePath)) {
        continue;
      }
      seenPaths.add(filePath);

      const result = await safeReadFile(filePath, maxFileSize);
      if ('error' in result) {
        warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
        continue;
      }

      const name = deriveNameFromFilename(file, config.rulesConfig.extension);
      const format: ContextFormat = `native:${agent}`;

      items.push({
        type: 'rule',
        format,
        name,
        description: `Native ${config.displayName} rule`,
        sourcePath: filePath,
        rawContent: result.content,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Native passthrough prompts discovery
// ---------------------------------------------------------------------------

async function discoverNativePrompts(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  existingCount: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenPaths = new Set<string>();
  let totalCount = existingCount;

  for (const [agentName, config] of Object.entries(targetAgents)) {
    const agent = agentName as TargetAgent;
    const nativeDiscovery = config.nativePromptDiscovery;
    if (!nativeDiscovery) {
      continue; // Agent has no native prompt discovery
    }

    const { sourceDir, pattern } = nativeDiscovery;
    const searchDir = join(basePath, sourceDir);

    const files = await listFiles(searchDir);
    for (const file of files) {
      if (totalCount + items.length >= maxItems) {
        warnings.push({
          type: 'cap-reached',
          message: `discovery capped at ${maxItems} prompts (including native)`,
        });
        return items;
      }

      if (!matchesPattern(file, pattern)) {
        continue;
      }

      const filePath = join(searchDir, file);
      if (seenPaths.has(filePath) || !isWithinBase(filePath, basePath)) {
        continue;
      }
      seenPaths.add(filePath);

      const result = await safeReadFile(filePath, maxFileSize);
      if ('error' in result) {
        warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
        continue;
      }

      // Derive the extension from promptsConfig if available, fallback to '.md'
      const extension = config.promptsConfig?.extension ?? '.md';
      const name = deriveNameFromFilename(file, extension);
      const format: ContextFormat = `native:${agent}`;

      items.push({
        type: 'prompt',
        format,
        name,
        description: `Native ${config.displayName} prompt`,
        sourcePath: filePath,
        rawContent: result.content,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Native passthrough agents discovery
// ---------------------------------------------------------------------------

async function discoverNativeAgents(
  basePath: string,
  maxItems: number,
  maxFileSize: number,
  existingCount: number,
  warnings: DiscoveryWarning[]
): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seenPaths = new Set<string>();
  let totalCount = existingCount;

  for (const [agentName, config] of Object.entries(targetAgents)) {
    const agent = agentName as TargetAgent;
    const nativeDiscovery = config.nativeAgentDiscovery;
    if (!nativeDiscovery) {
      continue; // Agent has no native agent discovery
    }

    const { sourceDir, pattern } = nativeDiscovery;
    const searchDir = join(basePath, sourceDir);

    const files = await listFiles(searchDir);
    for (const file of files) {
      if (totalCount + items.length >= maxItems) {
        warnings.push({
          type: 'cap-reached',
          message: `discovery capped at ${maxItems} agents (including native)`,
        });
        return items;
      }

      if (!matchesPattern(file, pattern)) {
        continue;
      }

      const filePath = join(searchDir, file);
      if (seenPaths.has(filePath) || !isWithinBase(filePath, basePath)) {
        continue;
      }
      seenPaths.add(filePath);

      const result = await safeReadFile(filePath, maxFileSize);
      if ('error' in result) {
        warnings.push({ type: 'file-too-large', message: result.error, path: filePath });
        continue;
      }

      // Derive the extension from agentsConfig if available, fallback to '.md'
      const extension = config.agentsConfig?.extension ?? '.md';
      const name = deriveNameFromFilename(file, extension);
      const format: ContextFormat = `native:${agent}`;

      items.push({
        type: 'agent',
        format,
        name,
        description: `Native ${config.displayName} agent`,
        sourcePath: filePath,
        rawContent: result.content,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all canonical and native context items in a source repo.
 *
 * Discovers `SKILL.md` (canonical), `RULES.md` (canonical + native passthrough),
 * `PROMPT.md` (canonical + native passthrough), `AGENT.md` (canonical +
 * native passthrough), and `INSTRUCTIONS.md` (canonical, root-only) files.
 * Each item is tagged with `type` and `format`.
 *
 * Security:
 * - Caps discovery at `maxItemsPerType` per context type (default 500).
 * - Rejects files larger than `maxFileSize` (default 100KB).
 * - Validates resolved paths stay within the base directory.
 */
export async function discover(
  basePath: string,
  options: DiscoverOptions = {}
): Promise<DiscoveryResult> {
  const maxItems = options.maxItemsPerType ?? MAX_ITEMS_PER_TYPE;
  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE_BYTES;
  const warnings: DiscoveryWarning[] = [];

  // Determine which types to discover — empty/omitted means all
  const typesToDiscover = new Set<ContextType>(
    options.types && options.types.length > 0 ? options.types : ALL_TYPES
  );

  const resolvedBase = resolve(basePath);

  // Helper that returns an empty array for skipped types
  const empty = (): Promise<DiscoveredItem[]> => Promise.resolve([]);

  // Discover in parallel — skills, rules, prompts, agents, and instructions are independent
  const [skills, canonicalRules, canonicalPrompts, canonicalAgents, canonicalInstructions] =
    await Promise.all([
      typesToDiscover.has('skill')
        ? discoverCanonicalSkills(resolvedBase, maxItems, maxFileSize, warnings)
        : empty(),
      typesToDiscover.has('rule')
        ? discoverCanonicalRules(resolvedBase, maxItems, maxFileSize, warnings)
        : empty(),
      typesToDiscover.has('prompt')
        ? discoverCanonicalPrompts(resolvedBase, maxItems, maxFileSize, warnings)
        : empty(),
      typesToDiscover.has('agent')
        ? discoverCanonicalAgents(resolvedBase, maxItems, maxFileSize, warnings)
        : empty(),
      typesToDiscover.has('instruction')
        ? discoverCanonicalInstructions(resolvedBase, maxItems, maxFileSize, warnings)
        : empty(),
    ]);

  // Native rules share the cap with canonical rules
  const nativeRules = typesToDiscover.has('rule')
    ? await discoverNativeRules(
        resolvedBase,
        maxItems,
        maxFileSize,
        canonicalRules.length,
        warnings
      )
    : [];

  // Native prompts share the cap with canonical prompts
  const nativePrompts = typesToDiscover.has('prompt')
    ? await discoverNativePrompts(
        resolvedBase,
        maxItems,
        maxFileSize,
        canonicalPrompts.length,
        warnings
      )
    : [];

  // Native agents share the cap with canonical agents
  const nativeAgents = typesToDiscover.has('agent')
    ? await discoverNativeAgents(
        resolvedBase,
        maxItems,
        maxFileSize,
        canonicalAgents.length,
        warnings
      )
    : [];

  return {
    items: [
      ...skills,
      ...canonicalRules,
      ...nativeRules,
      ...canonicalPrompts,
      ...nativePrompts,
      ...canonicalAgents,
      ...nativeAgents,
      ...canonicalInstructions,
    ],
    warnings,
  };
}

/**
 * Filter discovered items by context type.
 */
export function filterByType(items: DiscoveredItem[], type: ContextType): DiscoveredItem[] {
  return items.filter((item) => item.type === type);
}

/**
 * Filter discovered items by format.
 */
export function filterByFormat(items: DiscoveredItem[], format: ContextFormat): DiscoveredItem[] {
  return items.filter((item) => item.format === format);
}
