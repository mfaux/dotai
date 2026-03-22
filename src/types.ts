export type AgentType =
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'claude-code'
  | 'openclaw'
  | 'cline'
  | 'codebuddy'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'cortex'
  | 'crush'
  | 'cursor'
  | 'droid'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'iflow-cli'
  | 'junie'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mcpjam'
  | 'mistral-vibe'
  | 'mux'
  | 'neovate'
  | 'opencode'
  | 'openhands'
  | 'pi'
  | 'qoder'
  | 'qwen-code'
  | 'replit'
  | 'roo'
  | 'trae'
  | 'trae-cn'
  | 'windsurf'
  | 'zencoder'
  | 'pochi'
  | 'adal'
  | 'universal';

export interface Skill {
  name: string;
  description: string;
  path: string;
  /** Raw SKILL.md content for hashing */
  rawContent?: string;
  /** Name of the plugin this skill belongs to (if any) */
  pluginName?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  skillsDir: string;
  /** Global skills directory. Set to undefined if the agent doesn't support global installation. */
  globalSkillsDir: string | undefined;
  detectInstalled: () => Promise<boolean>;
  /** Whether to show this agent in the universal agents list. Defaults to true. */
  showInUniversalList?: boolean;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Skill name extracted from @skill syntax (e.g., owner/repo@skill-name) */
  skillFilter?: string;
}

/**
 * Represents a skill fetched from a remote host provider.
 */
export interface RemoteSkill {
  /** Display name of the skill (from frontmatter) */
  name: string;
  /** Description of the skill (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation directory name */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** The provider that fetched this skill */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Canonical context types (dotai extensions)
// ---------------------------------------------------------------------------

/** The six target agents for dotai transpilation. */
export type TargetAgent =
  | 'github-copilot'
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'cline'
  | 'opencode';

/** Context item types supported by dotai. */
export type ContextType = 'skill' | 'rule' | 'prompt' | 'agent';

/** How a discovered item was authored. */
export type ContextFormat = 'canonical' | `native:${TargetAgent}`;

/** Rule activation modes. */
export type RuleActivation = 'always' | 'auto' | 'manual' | 'glob';

/**
 * A discovered context item from a source repo, tagged with type and format.
 * This is the output of the discovery phase before transpilation.
 */
export interface DiscoveredItem {
  /** What kind of context this is. */
  type: ContextType;
  /** How the item was authored — canonical or agent-native. */
  format: ContextFormat;
  /** Kebab-case identifier (from frontmatter `name`). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Absolute path to the source file. */
  sourcePath: string;
  /** Raw file content for hashing. */
  rawContent: string;
}

/** Fields that can be overridden per target agent (excludes identity and structural fields). */
export type RuleOverrideFields = Partial<
  Omit<CanonicalRule, 'name' | 'schemaVersion' | 'body' | 'overrides'>
>;

/**
 * Canonical RULES.md representation after parsing and validation.
 */
export interface CanonicalRule {
  /** Kebab-case identifier, ≤ 128 chars. */
  name: string;
  /** Human-readable description, ≤ 512 chars. */
  description: string;
  /** File glob patterns for scoping, ≤ 50 entries. */
  globs: string[];
  /** When this rule activates. */
  activation: RuleActivation;
  /** Optional severity level. */
  severity?: string;
  /** Schema version (default 1). */
  schemaVersion: number;
  /** The markdown body (everything after frontmatter). */
  body: string;
  /** Per-agent override blocks from frontmatter. */
  overrides?: Partial<Record<TargetAgent, RuleOverrideFields>>;
}

/** Fields that can be overridden per target agent for prompts. */
export type PromptOverrideFields = Partial<
  Omit<CanonicalPrompt, 'name' | 'schemaVersion' | 'body' | 'overrides'>
>;

/**
 * Canonical PROMPT.md representation after parsing and validation.
 */
export interface CanonicalPrompt {
  /** Kebab-case identifier, <= 128 chars. */
  name: string;
  /** Human-readable description, <= 512 chars. */
  description: string;
  /** Hint text for the prompt's expected argument. */
  argumentHint?: string;
  /** Agent/persona to use (e.g., "plan"). */
  agent?: string;
  /** Model alias (e.g., "claude-sonnet-4"). Resolved per target agent. */
  model?: string;
  /** Tool names the prompt can use. */
  tools: string[];
  /** Schema version (default 1). */
  schemaVersion: number;
  /** The markdown body (everything after frontmatter). */
  body: string;
  /** Per-agent override blocks from frontmatter. */
  overrides?: Partial<Record<TargetAgent, PromptOverrideFields>>;
}

/** Fields that can be overridden per target agent for agents. */
export type AgentOverrideFields = Partial<
  Omit<CanonicalAgent, 'name' | 'body' | 'raw' | 'overrides'>
>;

/**
 * Canonical AGENT.md representation after parsing and validation.
 */
export interface CanonicalAgent {
  /** Kebab-case identifier, <= 128 chars. */
  name: string;
  /** Human-readable description, <= 512 chars. */
  description: string;
  /** Model alias (e.g., "claude-sonnet-4"). Resolved per target agent. */
  model?: string;
  /** Tool names the agent can use. */
  tools?: string[];
  /** Tool names the agent is not allowed to use (Claude Code only). */
  disallowedTools?: string[];
  /** Maximum conversation turns (Claude Code only). */
  maxTurns?: number;
  /** Whether the agent runs in the background (Claude Code only). */
  background?: boolean;
  /** The markdown body (everything after frontmatter). */
  body: string;
  /** The raw file content for hashing. */
  raw: string;
  /** Per-agent override blocks from frontmatter. */
  overrides?: Partial<Record<TargetAgent, AgentOverrideFields>>;
}

/**
 * Output of a transpiler — one file to write (or append) during install.
 */
export interface TranspiledOutput {
  /** Target filename (e.g., `code-style.mdc`). */
  filename: string;
  /** The transpiled file content. */
  content: string;
  /** Directory to write into (relative to project root). */
  outputDir: string;
  /** Whether to write a new file or append to an existing one. */
  mode: 'write' | 'append';
}

// ---------------------------------------------------------------------------
// Collision detection types (Phase 5: Installer + Collision Safety)
// ---------------------------------------------------------------------------

/**
 * Where an existing file at a collision path came from.
 *
 * - `'user'` — the file exists on disk but is not tracked in any lock file
 * - `'dotai'` — the file was previously installed by dotai and is tracked in the lock file
 */
export type CollisionSource = 'user' | 'dotai';

/**
 * What kind of collision was detected.
 *
 * - `'file-exists'` — a file already exists at the target path
 * - `'same-name'` — another item with the same (type, name) is already installed from a different source
 * - `'canonical-native'` — a canonical item would transpile to a path occupied by a native passthrough item from the same repo
 */
export type CollisionKind = 'file-exists' | 'same-name' | 'canonical-native';

/**
 * A collision detected during the pre-write check phase.
 *
 * Collisions block installation by default. Use `--force` to override.
 */
export interface Collision {
  /** What kind of collision this is. */
  kind: CollisionKind;
  /** Absolute path to the conflicting file. */
  path: string;
  /** Where the existing file came from. */
  existingSource: CollisionSource;
  /** Lock entry for the existing item, if tracked by dotai. */
  existingItem?: LockEntry;
  /** Human-readable error message for CLI output. */
  message: string;
}

/**
 * A planned file write — a TranspiledOutput resolved to an absolute path
 * with metadata about the source item.
 */
export interface PlannedWrite {
  /** Absolute path where the file will be written. */
  absolutePath: string;
  /** The transpiled output to write. */
  output: TranspiledOutput;
  /** Context type of the source item. */
  type: ContextType;
  /** Name of the source item (kebab-case). */
  name: string;
  /** Format of the source item. */
  format: ContextFormat;
  /** Source identifier (e.g., "owner/repo"). */
  source: string;
}

/**
 * An entry in the dotai lock file tracking an installed item.
 * Used for collision detection against previously installed items.
 */
export interface LockEntry {
  /** Context type. */
  type: ContextType;
  /** Kebab-case item name. */
  name: string;
  /** Source identifier (e.g., "owner/repo"). */
  source: string;
  /** How the item was authored. */
  format: ContextFormat;
  /** Which agents this item was installed for. */
  agents: TargetAgent[];
  /** Content hash for update detection. */
  hash: string;
  /** ISO timestamp of installation. */
  installedAt: string;
  /** Absolute output paths managed by this entry. */
  outputs: string[];
  /** Whether this item was installed in append mode (marker-based sections). */
  append?: boolean;
  /** Whether transpiled outputs are gitignored (opt-in via --gitignore flag). */
  gitignored?: boolean;
}
