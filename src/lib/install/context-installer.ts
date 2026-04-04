import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  DiscoveredItem,
  TargetAgent,
  TranspiledOutput,
  PlannedWrite,
  LockEntry,
  Collision,
} from '../../types.ts';
import type { ModelOverrides } from '../../model-aliases.ts';
import {
  transpilePromptForAllAgents,
  transpileAgentForAllAgents,
  transpileInstructionForAllAgents,
} from '../transpilers/index.ts';
import { checkCollisions, createPlannedWrite, filterBlockingCollisions } from './collisions.ts';
import { upsertSection } from './append-markers.ts';

// ---------------------------------------------------------------------------
// MVP Install Pipeline — Phase 5
//
// Orchestrates the full dotai install flow:
//   discover → transpile → check collisions → install
//
// This module handles transpiled prompt, agent, and instruction outputs.
// Skill installation uses the existing installer.ts symlink/copy semantics
// and is not part of this pipeline.
//
// Transactional semantics: all collision checks run before any writes.
// On write failure, all files written so far are rolled back.
// ---------------------------------------------------------------------------

/**
 * Options for the install pipeline.
 */
export interface InstallPipelineOptions {
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Target agents to install for. Defaults to all five. */
  targets?: readonly TargetAgent[];
  /** Source identifier for lock/collision tracking (e.g., "owner/repo"). */
  source: string;
  /** Existing lock entries for collision detection. */
  lockEntries?: LockEntry[];
  /** Overwrite collisions instead of aborting. */
  force?: boolean;
  /** Preview planned writes without executing them. */
  dryRun?: boolean;
  /** Use append mode for Copilot (AGENTS.md) and Claude Code (CLAUDE.md). */
  append?: boolean;
  /** User/project model alias overrides from package.json. */
  modelOverrides?: ModelOverrides;
}

/**
 * Result of a single planned file write with metadata.
 */
export interface PipelineWrite {
  /** The planned write with absolute path and metadata. */
  planned: PlannedWrite;
  /** The target agent this write is for. */
  agent: TargetAgent;
}

/**
 * Result of the install pipeline execution.
 */
export interface InstallPipelineResult {
  /** Whether the pipeline completed successfully. */
  success: boolean;
  /** All planned writes (populated in both dry-run and real modes). */
  writes: PipelineWrite[];
  /** Collisions detected during the check phase. */
  collisions: Collision[];
  /** Items that failed transpilation (with reason). */
  skipped: Array<{ item: DiscoveredItem; reason: string }>;
  /** Files that were actually written (empty in dry-run mode). */
  written: string[];
  /** Error message if the pipeline failed. */
  error?: string;
}

/** All four target agents. */
const ALL_AGENTS: readonly TargetAgent[] = [
  'github-copilot',
  'claude-code',
  'cursor',
  'opencode',
] as const;

/**
 * Plan transpiled outputs for discovered prompt, agent, and instruction items.
 *
 * Transpiles each item for all target agents and builds PlannedWrite
 * entries with resolved absolute paths and metadata.
 *
 * Skills are not transpiled — they use existing symlink/copy semantics
 * via installer.ts and are skipped here.
 */
export function planContextWrites(
  items: DiscoveredItem[],
  options: InstallPipelineOptions
): { writes: PipelineWrite[]; skipped: Array<{ item: DiscoveredItem; reason: string }> } {
  const agents = options.targets ?? ALL_AGENTS;
  const writes: PipelineWrite[] = [];
  const skipped: Array<{ item: DiscoveredItem; reason: string }> = [];

  for (const item of items) {
    // Skip skills — they use existing installer.ts symlink/copy semantics
    if (item.type === 'skill') {
      continue;
    }

    if (item.type !== 'prompt' && item.type !== 'agent' && item.type !== 'instruction') {
      skipped.push({ item, reason: `unsupported context type: ${item.type}` });
      continue;
    }

    const outputs =
      item.type === 'instruction'
        ? transpileInstructionForAllAgents(item, agents)
        : item.type === 'agent'
          ? transpileAgentForAllAgents(item, agents, options.modelOverrides)
          : transpilePromptForAllAgents(item, agents, options.modelOverrides);

    if (outputs.length === 0) {
      skipped.push({ item, reason: 'transpilation produced no outputs' });
      continue;
    }

    for (const output of outputs) {
      const agent = resolveAgentFromOutput(output, agents);
      if (!agent) {
        continue;
      }

      const planned = createPlannedWrite(
        output,
        options.projectRoot,
        item.type,
        item.name,
        item.format,
        options.source
      );

      writes.push({ planned, agent });
    }
  }

  return { writes, skipped };
}

/**
 * Execute the full MVP install pipeline.
 *
 * Flow:
 * 1. Plan: transpile discovered context → PlannedWrites
 * 2. Check: detect collisions against lock entries and filesystem
 * 3. Execute: write files to disk (or report dry-run plan)
 *
 * Transactional: if any write fails, all writes from this invocation
 * are rolled back (deleted).
 */
export async function executeInstallPipeline(
  items: DiscoveredItem[],
  options: InstallPipelineOptions
): Promise<InstallPipelineResult> {
  const lockEntries = options.lockEntries ?? [];
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  // Phase 1: Plan — transpile and build planned writes
  const { writes, skipped } = planContextWrites(items, options);

  if (writes.length === 0) {
    return {
      success: true,
      writes,
      collisions: [],
      skipped,
      written: [],
    };
  }

  // Phase 2: Check — detect collisions
  const plannedWrites = writes.map((w) => w.planned);
  const collisions = checkCollisions(plannedWrites, {
    projectRoot: options.projectRoot,
    lockEntries,
  });

  const blocking = filterBlockingCollisions(collisions, force);

  if (blocking.length > 0) {
    return {
      success: false,
      writes,
      collisions,
      skipped,
      written: [],
      error: `${blocking.length} collision(s) detected. Use --force to override.`,
    };
  }

  // Dry-run mode: report plan without writing
  if (dryRun) {
    return {
      success: true,
      writes,
      collisions,
      skipped,
      written: [],
    };
  }

  // Phase 3: Execute — write files to disk with rollback on failure
  const written = await writeFilesWithRollback(plannedWrites);

  return {
    success: written.success,
    writes,
    collisions,
    skipped,
    written: written.paths,
    error: written.error,
  };
}

// ---------------------------------------------------------------------------
// Internal: file writing with transactional rollback
// ---------------------------------------------------------------------------

interface WriteResult {
  success: boolean;
  paths: string[];
  error?: string;
}

/**
 * Snapshot of a file before an append-mode mutation.
 * Used for rollback: restore original content on failure.
 */
interface AppendSnapshot {
  path: string;
  /** Original content before mutation, or `null` if the file did not exist. */
  originalContent: string | null;
}

/**
 * Write all planned files to disk. If any write fails, roll back all
 * files written so far (delete them) and restore append-mode files
 * to their original content.
 *
 * Append-mode writes (`output.mode === 'append'`) use marker-based
 * section management via `upsertSection()`. The transpiled content is
 * inserted (or replaced) as a named section identified by the planned
 * write's `name` field.
 */
async function writeFilesWithRollback(writes: PlannedWrite[]): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const appendSnapshots: AppendSnapshot[] = [];

  try {
    for (const write of writes) {
      // Ensure target directory exists
      const dir = dirname(write.absolutePath);
      await mkdir(dir, { recursive: true });

      if (write.output.mode === 'append') {
        // Append mode: read existing content, upsert the named section
        let existing: string | null = null;
        try {
          existing = await readFile(write.absolutePath, 'utf-8');
        } catch {
          // File does not exist yet — start with empty content
        }

        // Save snapshot for rollback before mutating
        appendSnapshots.push({ path: write.absolutePath, originalContent: existing });

        const updated = upsertSection(existing ?? '', write.name, write.output.content);
        await writeFile(write.absolutePath, updated, 'utf-8');
      } else {
        // Normal write mode: create/overwrite the file
        await writeFile(write.absolutePath, write.output.content, 'utf-8');
      }

      writtenPaths.push(write.absolutePath);
    }

    return { success: true, paths: writtenPaths };
  } catch (error) {
    // Rollback: restore append snapshots and delete regular writes
    await rollbackWrites(writtenPaths, appendSnapshots);

    return {
      success: false,
      paths: [],
      error: error instanceof Error ? error.message : 'Unknown write error',
    };
  }
}

/**
 * Roll back previously written files by deleting them, and restore
 * append-mode files to their original content.
 * Errors during rollback are silently ignored — we're already in an error path.
 */
async function rollbackWrites(paths: string[], appendSnapshots: AppendSnapshot[]): Promise<void> {
  // Build a set of paths that are append targets for quick lookup
  const appendPaths = new Set(appendSnapshots.map((s) => s.path));

  for (const path of paths) {
    try {
      if (appendPaths.has(path)) {
        // Restore append target to its original content
        const snapshot = appendSnapshots.find((s) => s.path === path);
        if (snapshot && snapshot.originalContent !== null) {
          await writeFile(path, snapshot.originalContent, 'utf-8');
        } else {
          // File didn't exist before — delete it
          await rm(path, { force: true });
        }
      } else {
        await rm(path, { force: true });
      }
    } catch {
      // Ignore rollback errors — best effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: agent resolution from TranspiledOutput
// ---------------------------------------------------------------------------

/** Output directory prefixes for each target agent (prompts + agents). */
const OUTPUT_DIR_TO_AGENT: ReadonlyArray<{ prefix: string; agent: TargetAgent }> = [
  // Prompts
  { prefix: '.github/prompts', agent: 'github-copilot' },
  { prefix: '.claude/commands', agent: 'claude-code' },
  { prefix: '.opencode/commands', agent: 'opencode' },
  // Agents
  { prefix: '.github/agents', agent: 'github-copilot' },
  { prefix: '.claude/agents', agent: 'claude-code' },
  { prefix: '.opencode/agents', agent: 'opencode' },
];

/**
 * Append-mode filename → agent mapping.
 * Append transpilers output to the project root (`outputDir: '.'`) with
 * well-known filenames like `AGENTS.md` and `CLAUDE.md`.
 */
const APPEND_FILENAME_TO_AGENT: ReadonlyArray<{
  outputDir: string;
  filename: string;
  agent: TargetAgent;
}> = [
  // Instructions: Copilot → .github/copilot-instructions.md
  { outputDir: '.github', filename: 'copilot-instructions.md', agent: 'github-copilot' },
  // Instructions: Claude → CLAUDE.md
  { outputDir: '.', filename: 'CLAUDE.md', agent: 'claude-code' },
  // Instructions: Cursor + OpenCode → AGENTS.md (deduplicated by transpiler)
  { outputDir: '.', filename: 'AGENTS.md', agent: 'cursor' },
];

/**
 * Resolve which target agent a TranspiledOutput belongs to by matching
 * its outputDir against known agent directory prefixes, or by matching
 * append-mode filenames for outputs in the project root.
 */
function resolveAgentFromOutput(
  output: TranspiledOutput,
  agents: readonly TargetAgent[]
): TargetAgent | null {
  // Check append-mode outputs first (well-known dir+filename combinations)
  if (output.mode === 'append') {
    for (const { outputDir, filename, agent } of APPEND_FILENAME_TO_AGENT) {
      if (
        output.outputDir === outputDir &&
        output.filename === filename &&
        agents.includes(agent)
      ) {
        return agent;
      }
    }
  }

  for (const { prefix, agent } of OUTPUT_DIR_TO_AGENT) {
    if (output.outputDir === prefix && agents.includes(agent)) {
      return agent;
    }
  }
  return null;
}
