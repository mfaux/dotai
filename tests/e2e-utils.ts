/**
 * End-to-end test utilities for dotai.
 *
 * Shared infrastructure for E2E tests that exercise the full flow from
 * `dotai add` through transpilation to file output to lock update.
 *
 * Provides:
 * - Temp project directory creation with `.git` init
 * - Test source repo creation with canonical/native files
 * - File content and lock file assertion helpers
 * - Cleanup helpers
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import type { ContextType, LockEntry, TargetAgent } from '../src/types.ts';
import type { DotaiLockFile } from '../src/dotai-lock.ts';
import { readDotaiLock } from '../src/dotai-lock.ts';
import { targetAgents } from '../src/target-agents.ts';

// ---------------------------------------------------------------------------
// Temp project directory
// ---------------------------------------------------------------------------

/**
 * Create a temporary project directory with a `.git` init.
 *
 * Returns the absolute path to the project root. The caller is responsible
 * for cleanup (use `cleanupProject`).
 */
export function createTempProject(prefix = 'dotai-e2e-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execSync('git init --initial-branch=main', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Remove a temporary project directory and all its contents.
 */
export function cleanupProject(projectRoot: string): void {
  rmSync(projectRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test source repo creation
// ---------------------------------------------------------------------------

/**
 * Create a minimal RULES.md content string for testing.
 */
export function makeRuleContent(
  name: string,
  opts: { description?: string; activation?: string; globs?: string[]; body?: string } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const activation = opts.activation ?? 'always';
  const globLines =
    opts.globs && opts.globs.length > 0
      ? `globs:\n${opts.globs.map((g) => `  - "${g}"`).join('\n')}\n`
      : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    `activation: ${activation}`,
    globLines ? globLines.trimEnd() : null,
    '---',
    '',
    opts.body ?? `Body content for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Create a minimal PROMPT.md content string for testing.
 */
export function makePromptContent(
  name: string,
  opts: { description?: string; agent?: string; tools?: string[]; body?: string } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const agentLine = opts.agent ? `agent: ${opts.agent}\n` : '';
  const toolLines =
    opts.tools && opts.tools.length > 0
      ? `tools:\n${opts.tools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    agentLine ? agentLine.trimEnd() : null,
    toolLines ? toolLines.trimEnd() : null,
    '---',
    '',
    opts.body ?? `Prompt body for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Create a minimal AGENT.md content string for testing.
 */
export function makeAgentContent(
  name: string,
  opts: {
    description?: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    background?: boolean;
    body?: string;
  } = {}
): string {
  const desc = opts.description ?? `Description for ${name}`;
  const modelLine = opts.model ? `model: ${opts.model}\n` : '';
  const toolLines =
    opts.tools && opts.tools.length > 0
      ? `tools:\n${opts.tools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';
  const disallowedToolLines =
    opts.disallowedTools && opts.disallowedTools.length > 0
      ? `disallowed-tools:\n${opts.disallowedTools.map((t) => `  - ${t}`).join('\n')}\n`
      : '';
  const maxTurnsLine = opts.maxTurns !== undefined ? `max-turns: ${opts.maxTurns}\n` : '';
  const backgroundLine = opts.background !== undefined ? `background: ${opts.background}\n` : '';

  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    modelLine ? modelLine.trimEnd() : null,
    toolLines ? toolLines.trimEnd() : null,
    disallowedToolLines ? disallowedToolLines.trimEnd() : null,
    maxTurnsLine ? maxTurnsLine.trimEnd() : null,
    backgroundLine ? backgroundLine.trimEnd() : null,
    '---',
    '',
    opts.body ?? `Agent body for ${name}.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Source repo scaffolding
// ---------------------------------------------------------------------------

/**
 * Write a canonical context file into a source repo directory structure.
 *
 * Creates the appropriate subdirectory (e.g., `rules/<name>/RULES.md`)
 * and writes the content file.
 */
export function writeCanonicalFile(
  sourceRoot: string,
  type: ContextType,
  name: string,
  content: string
): string {
  const fileMap: Record<string, string> = {
    rule: `rules/${name}/RULES.md`,
    prompt: `prompts/${name}/PROMPT.md`,
    agent: `agents/${name}/AGENT.md`,
    skill: `skills/${name}/SKILL.md`,
  };
  const relPath = fileMap[type]!;
  const absPath = join(sourceRoot, relPath);
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, content, 'utf-8');
  return absPath;
}

/**
 * Write a native passthrough file into a source repo directory structure.
 *
 * Creates the appropriate agent-native directory (e.g., `.cursor/rules/`)
 * and writes the content file.
 */
export function writeNativeFile(
  sourceRoot: string,
  type: ContextType,
  agent: TargetAgent,
  filename: string,
  content: string
): string {
  const config = targetAgents[agent];
  let outputDir: string;
  if (type === 'rule') {
    outputDir = config.nativeRuleDiscovery.sourceDir;
  } else if (type === 'prompt' && config.nativePromptDiscovery) {
    outputDir = config.nativePromptDiscovery.sourceDir;
  } else if (type === 'agent' && config.nativeAgentDiscovery) {
    outputDir = config.nativeAgentDiscovery.sourceDir;
  } else {
    throw new Error(`Agent ${agent} does not support native ${type} files`);
  }

  const absPath = join(sourceRoot, outputDir, filename);
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, content, 'utf-8');
  return absPath;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a file exists at the given path and optionally check its content.
 *
 * @param filePath - Absolute path to the expected file
 * @param contentCheck - Optional string or regex to match against file content
 */
export function assertFileExists(filePath: string, contentCheck?: string | RegExp): void {
  if (!existsSync(filePath)) {
    throw new Error(`Expected file to exist: ${filePath}`);
  }
  if (contentCheck !== undefined) {
    const content = readFileSync(filePath, 'utf-8');
    if (typeof contentCheck === 'string') {
      if (!content.includes(contentCheck)) {
        throw new Error(
          `File ${filePath} does not contain expected string.\n` +
            `  Expected to contain: ${JSON.stringify(contentCheck)}\n` +
            `  Actual content: ${JSON.stringify(content.slice(0, 500))}`
        );
      }
    } else {
      if (!contentCheck.test(content)) {
        throw new Error(
          `File ${filePath} does not match expected pattern.\n` +
            `  Pattern: ${contentCheck}\n` +
            `  Actual content: ${JSON.stringify(content.slice(0, 500))}`
        );
      }
    }
  }
}

/**
 * Assert that a file does NOT exist at the given path.
 */
export function assertFileNotExists(filePath: string): void {
  if (existsSync(filePath)) {
    throw new Error(`Expected file NOT to exist: ${filePath}`);
  }
}

/**
 * Read the file content at the given path.
 * Throws if the file does not exist.
 */
export function readOutputFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/**
 * Get the expected output path for a transpiled context item.
 *
 * @param projectRoot - Absolute path to the project root
 * @param agent - Target agent
 * @param type - Context type
 * @param name - Item name (kebab-case)
 * @returns Absolute path to the expected output file
 */
export function getExpectedOutputPath(
  projectRoot: string,
  agent: TargetAgent,
  type: ContextType,
  name: string
): string {
  const config = targetAgents[agent];
  let outputDir: string;
  let extension: string;

  if (type === 'rule') {
    outputDir = config.rulesConfig.outputDir;
    extension = config.rulesConfig.extension;
  } else if (type === 'prompt') {
    if (!config.promptsConfig) {
      throw new Error(`Agent ${agent} does not support prompts`);
    }
    outputDir = config.promptsConfig.outputDir;
    extension = config.promptsConfig.extension;
  } else if (type === 'agent') {
    if (!config.agentsConfig) {
      throw new Error(`Agent ${agent} does not support agents`);
    }
    outputDir = config.agentsConfig.outputDir;
    extension = config.agentsConfig.extension;
  } else {
    throw new Error(`Unsupported context type for output path: ${type}`);
  }

  return join(projectRoot, outputDir, `${name}${extension}`);
}

// ---------------------------------------------------------------------------
// Lock file assertion helpers
// ---------------------------------------------------------------------------

/**
 * Read and return the dotai lock file from a project directory.
 * Returns an empty lock if the file doesn't exist.
 */
export async function getLockFile(projectRoot: string): Promise<DotaiLockFile> {
  const result = await readDotaiLock(projectRoot);
  return result.lock;
}

/**
 * Assert that a lock entry exists for the given (type, name) and
 * optionally verify its properties.
 */
export async function assertLockEntry(
  projectRoot: string,
  type: ContextType,
  name: string,
  checks?: {
    source?: string;
    format?: string;
    agents?: TargetAgent[];
    hash?: string;
    outputCount?: number;
  }
): Promise<LockEntry> {
  const lock = await getLockFile(projectRoot);
  const entry = lock.items.find((item) => item.type === type && item.name === name);

  if (!entry) {
    const available = lock.items.map((i) => `${i.type}:${i.name}`).join(', ') || '(none)';
    throw new Error(
      `Expected lock entry for ${type}:${name} not found.\n` + `  Available entries: ${available}`
    );
  }

  if (checks) {
    if (checks.source !== undefined && entry.source !== checks.source) {
      throw new Error(
        `Lock entry ${type}:${name} source mismatch.\n` +
          `  Expected: ${checks.source}\n` +
          `  Actual: ${entry.source}`
      );
    }
    if (checks.format !== undefined && entry.format !== checks.format) {
      throw new Error(
        `Lock entry ${type}:${name} format mismatch.\n` +
          `  Expected: ${checks.format}\n` +
          `  Actual: ${entry.format}`
      );
    }
    if (checks.agents !== undefined) {
      const sortedExpected = [...checks.agents].sort();
      const sortedActual = [...entry.agents].sort();
      if (JSON.stringify(sortedExpected) !== JSON.stringify(sortedActual)) {
        throw new Error(
          `Lock entry ${type}:${name} agents mismatch.\n` +
            `  Expected: ${JSON.stringify(sortedExpected)}\n` +
            `  Actual: ${JSON.stringify(sortedActual)}`
        );
      }
    }
    if (checks.hash !== undefined && entry.hash !== checks.hash) {
      throw new Error(
        `Lock entry ${type}:${name} hash mismatch.\n` +
          `  Expected: ${checks.hash}\n` +
          `  Actual: ${entry.hash}`
      );
    }
    if (checks.outputCount !== undefined && entry.outputs.length !== checks.outputCount) {
      throw new Error(
        `Lock entry ${type}:${name} output count mismatch.\n` +
          `  Expected: ${checks.outputCount}\n` +
          `  Actual: ${entry.outputs.length}`
      );
    }
  }

  return entry;
}

/**
 * Assert that NO lock entry exists for the given (type, name).
 */
export async function assertNoLockEntry(
  projectRoot: string,
  type: ContextType,
  name: string
): Promise<void> {
  const lock = await getLockFile(projectRoot);
  const entry = lock.items.find((item) => item.type === type && item.name === name);

  if (entry) {
    throw new Error(
      `Expected NO lock entry for ${type}:${name}, but found one ` +
        `(source: ${entry.source}, format: ${entry.format})`
    );
  }
}

/**
 * Assert the total number of entries in the lock file.
 */
export async function assertLockEntryCount(
  projectRoot: string,
  expectedCount: number
): Promise<void> {
  const lock = await getLockFile(projectRoot);
  if (lock.items.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} lock entries, got ${lock.items.length}.\n` +
        `  Entries: ${lock.items.map((i) => `${i.type}:${i.name}`).join(', ') || '(none)'}`
    );
  }
}

// ---------------------------------------------------------------------------
// All-agents helpers
// ---------------------------------------------------------------------------

/** All five target agents. */
export const ALL_AGENTS: readonly TargetAgent[] = [
  'github-copilot',
  'claude-code',
  'cursor',
  'windsurf',
  'cline',
] as const;

/** Target agents that support canonical prompt transpilation. */
export const PROMPT_AGENTS: readonly TargetAgent[] = ['github-copilot', 'claude-code'] as const;

/** Target agents that support canonical agent transpilation. */
export const AGENT_AGENTS: readonly TargetAgent[] = ['github-copilot', 'claude-code'] as const;

/**
 * Write a pre-existing file at a target output path.
 * Useful for collision detection tests.
 */
export function writeUserFile(filePath: string, content = 'user-owned content'): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Temp project directory with cleanup (async)
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a `project` subdirectory.
 *
 * Returns `{ tempDir, projectDir, cleanup }`.
 * Call `cleanup()` in `afterEach` to remove the temp directory.
 *
 * Replaces the repeated `beforeEach`/`afterEach` boilerplate found across
 * cli-lock-integration tests.
 */
export async function createTempProjectDir(
  prefix = 'cli-lock-integ-'
): Promise<{ tempDir: string; projectDir: string; cleanup: () => Promise<void> }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  const projectDir = join(tempDir, 'project');
  await mkdir(projectDir, { recursive: true });
  return {
    tempDir,
    projectDir,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Simple content factories (matching cli-lock-integration originals)
// ---------------------------------------------------------------------------

/**
 * Create a canonical RULES.md with standard frontmatter.
 *
 * Uses a fixed `globs: ["*.ts"]` and `activation: always` — matches the
 * factory pattern from cli-lock-integration tests.
 */
export function makeSimpleRulesContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
globs:
  - "*.ts"
activation: always
---

${body}
`;
}

/**
 * Create a canonical AGENT.md with simple frontmatter.
 *
 * Matches the factory pattern from cli-lock-integration tests.
 */
export function makeSimpleAgentContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

/**
 * Create a canonical PROMPT.md with simple frontmatter.
 *
 * Matches the factory pattern from cli-lock-integration tests.
 */
export function makeSimplePromptContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

// ---------------------------------------------------------------------------
// Source repo creation (unified, async)
// ---------------------------------------------------------------------------

/**
 * Create a source repo with canonical context files.
 *
 * When a single item is provided, the file is placed at the repo root.
 * When multiple items are provided, each is placed in its own subdirectory
 * under a type-specific parent directory (e.g., `rules/<name>/RULES.md`).
 *
 * @param baseDir - Parent directory for the source repo
 * @param items - Array of `{ name, description, body }` for each item
 * @param type - Context type: `'rule'` (default), `'agent'`, or `'prompt'`
 * @returns Absolute path to the created source repo directory
 */
export async function createTestSourceRepo(
  baseDir: string,
  items: Array<{ name: string; description: string; body: string }>,
  type: 'rule' | 'agent' | 'prompt' = 'rule'
): Promise<string> {
  const dirNames: Record<string, string> = {
    rule: 'source-repo',
    agent: 'agent-source-repo',
    prompt: 'prompt-source-repo',
  };
  const fileNames: Record<string, string> = {
    rule: 'RULES.md',
    agent: 'AGENT.md',
    prompt: 'PROMPT.md',
  };
  const subdirNames: Record<string, string> = {
    rule: 'rules',
    agent: 'agents',
    prompt: 'prompts',
  };
  const contentFns: Record<string, (n: string, d: string, b: string) => string> = {
    rule: makeSimpleRulesContent,
    agent: makeSimpleAgentContent,
    prompt: makeSimplePromptContent,
  };

  const repoDir = join(baseDir, dirNames[type]!);
  await mkdir(repoDir, { recursive: true });

  const contentFn = contentFns[type]!;
  const fileName = fileNames[type]!;

  if (items.length === 1) {
    const item = items[0]!;
    await writeFile(join(repoDir, fileName), contentFn(item.name, item.description, item.body));
  } else {
    const subdir = join(repoDir, subdirNames[type]!);
    await mkdir(subdir, { recursive: true });
    for (const item of items) {
      const itemDir = join(subdir, item.name);
      await mkdir(itemDir, { recursive: true });
      await writeFile(join(itemDir, fileName), contentFn(item.name, item.description, item.body));
    }
  }

  return repoDir;
}

// ---------------------------------------------------------------------------
// Lock file reader (async)
// ---------------------------------------------------------------------------

/**
 * Read and parse the `.dotai-lock.json` from a project directory.
 *
 * Throws if the file does not exist or cannot be parsed.
 */
export async function readLockFileFromDisk(projectDir: string): Promise<DotaiLockFile> {
  const content = await readFile(join(projectDir, '.dotai-lock.json'), 'utf-8');
  return JSON.parse(content) as DotaiLockFile;
}
