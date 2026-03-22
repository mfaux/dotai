import pc from 'picocolors';
import { resolve } from 'path';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { parseSource } from './source-parser.ts';
import { discover, filterByType } from './rule-discovery.ts';
import { executeInstallPipeline } from './rule-installer.ts';
import {
  readDotaiLock,
  writeDotaiLock,
  computeContentHash,
  upsertLockEntry,
  getLockEntriesByType,
} from './dotai-lock.ts';
import { loadModelOverrides } from './model-aliases.ts';
import { TARGET_AGENTS } from './target-agents.ts';
import type { ContextType, LockEntry, TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Rule, prompt & agent check/update — reads .dotai-lock.json and compares content hashes
//
// For `dotai check`: reports which rules/prompts/agents have changed upstream.
// For `dotai update`: re-discovers, re-transpiles, and re-installs changed rules/prompts/agents.
//
// The flow per source repo:
//   1. Read lock entries grouped by source (rules, prompts, and agents)
//   2. Clone (or resolve local path to) the source repo
//   3. Discover rules/prompts/agents in the freshly fetched source
//   4. Compare content hashes for each locked entry
//   5. (update only) Re-run install pipeline for changed entries
// ---------------------------------------------------------------------------

/**
 * A rule that has an available update.
 */
export interface RuleUpdate {
  /** Lock entry for the installed rule. */
  entry: LockEntry;
  /** Current content hash (stored in lock). */
  currentHash: string;
  /** Latest content hash (computed from fetched source). */
  latestHash: string;
}

/**
 * A rule that could not be checked.
 */
export interface RuleCheckError {
  /** Lock entry for the rule. */
  entry: LockEntry;
  /** Error message. */
  error: string;
}

/**
 * Result of checking for rule updates.
 */
export interface RuleCheckResult {
  /** Total number of rules checked. */
  totalChecked: number;
  /** Rules with available updates. */
  updates: RuleUpdate[];
  /** Rules that failed to check. */
  errors: RuleCheckError[];
}

/**
 * Result of updating rules.
 */
export interface RuleUpdateResult {
  /** Total number of rules checked. */
  totalChecked: number;
  /** Number of rules successfully updated. */
  successCount: number;
  /** Number of rules that failed to update. */
  failCount: number;
  /** Messages for CLI output. */
  messages: string[];
}

// ---------------------------------------------------------------------------
// Check — compare lock hashes against fresh source content
// ---------------------------------------------------------------------------

/**
 * Check installed rules, prompts, and agents for available updates.
 *
 * Reads `.dotai-lock.json`, fetches each source repo, and compares
 * content hashes for all installed rules, prompts, and agents.
 */
export async function checkRuleUpdates(projectRoot: string): Promise<RuleCheckResult> {
  const { lock } = await readDotaiLock(projectRoot);
  const ruleEntries = getLockEntriesByType(lock, 'rule');
  const promptEntries = getLockEntriesByType(lock, 'prompt');
  const agentEntries = getLockEntriesByType(lock, 'agent');
  const allEntries = [...ruleEntries, ...promptEntries, ...agentEntries];

  if (allEntries.length === 0) {
    return { totalChecked: 0, updates: [], errors: [] };
  }

  // Group entries by source for efficient fetching
  const bySource = groupBySource(allEntries);

  const updates: RuleUpdate[] = [];
  const errors: RuleCheckError[] = [];
  let totalChecked = 0;

  for (const [source, entries] of bySource) {
    let cloneDir: string | undefined;

    try {
      // Fetch source repo
      const fetched = await fetchSource(source);
      cloneDir = fetched.isClone ? fetched.path : undefined;

      // Discover rules, prompts, and agents in the fresh source
      const { items } = await discover(fetched.path);

      // Compare each locked entry against fresh content
      for (const entry of entries) {
        totalChecked++;

        // Filter discovered items by the entry's own type
        const freshItems = filterByType(items, entry.type as ContextType);
        const freshItem = freshItems.find(
          (r) => r.name === entry.name && r.format === entry.format
        );

        if (!freshItem) {
          const typeLabel =
            entry.type === 'prompt' ? 'Prompt' : entry.type === 'agent' ? 'Agent' : 'Rule';
          errors.push({
            entry,
            error: `${typeLabel} '${entry.name}' no longer found in source`,
          });
          continue;
        }

        const latestHash = computeContentHash(freshItem.rawContent);
        if (latestHash !== entry.hash) {
          updates.push({
            entry,
            currentHash: entry.hash,
            latestHash,
          });
        }
      }
    } catch (err) {
      // Source fetch failed — mark all entries from this source as errors
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      for (const entry of entries) {
        totalChecked++;
        errors.push({ entry, error: errorMsg });
      }
    } finally {
      // Clean up temp dir if we cloned
      if (cloneDir) {
        await cleanupTempDir(cloneDir).catch(() => {});
      }
    }
  }

  return { totalChecked, updates, errors };
}

// ---------------------------------------------------------------------------
// Update — re-install rules, prompts and agents with changed content
// ---------------------------------------------------------------------------

/**
 * Update installed rules, prompts, and agents to their latest versions.
 *
 * Performs a single-pass per source repo: clone → discover → compare hashes →
 * install changed entries → cleanup. This avoids the double-cloning that would
 * occur if we called `checkRuleUpdates` first (which clones + cleans up) and
 * then cloned again for the update phase.
 */
export async function updateRules(projectRoot: string): Promise<RuleUpdateResult> {
  const messages: string[] = [];
  const resolvedRoot = resolve(projectRoot);

  // Read lock file and gather all rule/prompt/agent entries
  const { lock } = await readDotaiLock(resolvedRoot);
  const ruleEntries = getLockEntriesByType(lock, 'rule');
  const promptEntries = getLockEntriesByType(lock, 'prompt');
  const agentEntries = getLockEntriesByType(lock, 'agent');
  const allEntries = [...ruleEntries, ...promptEntries, ...agentEntries];

  if (allEntries.length === 0) {
    return { totalChecked: 0, successCount: 0, failCount: 0, messages };
  }

  // Group entries by source for efficient fetching
  const bySource = groupBySource(allEntries);

  // Load model overrides once — the result is the same for every entry
  const modelOverrides = await loadModelOverrides(resolvedRoot);

  let totalChecked = 0;
  let successCount = 0;
  let failCount = 0;
  let updatedLock = lock;

  for (const [source, entries] of bySource) {
    let cloneDir: string | undefined;

    try {
      // Fetch source repo (cloned once per source)
      const fetched = await fetchSource(source);
      cloneDir = fetched.isClone ? fetched.path : undefined;

      // Discover rules, prompts, and agents in the fresh source
      const { items } = await discover(fetched.path);

      for (const entry of entries) {
        totalChecked++;

        // Filter discovered items by the entry's own type
        const freshItems = filterByType(items, entry.type as ContextType);
        const freshItem = freshItems.find(
          (r) => r.name === entry.name && r.format === entry.format
        );

        if (!freshItem) {
          // Entry no longer exists in source — skip (not an update failure)
          continue;
        }

        // Compare content hash — skip if unchanged
        const latestHash = computeContentHash(freshItem.rawContent);
        if (latestHash === entry.hash) {
          continue;
        }

        // Content changed — re-run install pipeline
        const agents: TargetAgent[] = entry.agents.length > 0 ? entry.agents : [...TARGET_AGENTS];

        const pipelineResult = await executeInstallPipeline([freshItem], {
          projectRoot: resolvedRoot,
          targets: agents,
          source,
          lockEntries: updatedLock.items,
          force: true, // Updates should overwrite existing managed files
          append: entry.append,
          modelOverrides,
        });

        if (!pipelineResult.success) {
          failCount++;
          messages.push(
            pc.red(`Failed: ${entry.name} — ${pipelineResult.error ?? 'unknown error'}`)
          );
          continue;
        }

        // Update lock entry with new hash
        const entryWrites = pipelineResult.writes.filter((w) => w.planned.name === entry.name);
        const entryAgents = [...new Set(entryWrites.map((w) => w.agent))];
        const outputPaths = entryWrites.map((w) => w.planned.absolutePath);

        const updatedEntry: LockEntry = {
          type: entry.type,
          name: entry.name,
          source,
          format: entry.format,
          agents: entryAgents.length > 0 ? entryAgents : entry.agents,
          hash: computeContentHash(freshItem.rawContent),
          installedAt: entry.installedAt,
          outputs: outputPaths.length > 0 ? outputPaths : entry.outputs,
          ...(entry.append && { append: true }),
        };

        updatedLock = upsertLockEntry(updatedLock, updatedEntry);
        successCount++;
        messages.push(pc.green(`Updated: ${entry.name}`));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      for (const entry of entries) {
        totalChecked++;
        failCount++;
        messages.push(pc.red(`Failed: ${entry.name} — ${errorMsg}`));
      }
    } finally {
      if (cloneDir) {
        await cleanupTempDir(cloneDir).catch(() => {});
      }
    }
  }

  // Write updated lock file if any updates succeeded
  if (successCount > 0) {
    await writeDotaiLock(updatedLock, resolvedRoot);
  }

  return {
    totalChecked,
    successCount,
    failCount,
    messages,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Group lock entries by source.
 */
function groupBySource(entries: LockEntry[]): Map<string, LockEntry[]> {
  const grouped = new Map<string, LockEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.source) ?? [];
    existing.push(entry);
    grouped.set(entry.source, existing);
  }
  return grouped;
}

/**
 * Result of fetching a source repo.
 */
interface FetchSourceResult {
  /** Absolute path to the source directory. */
  path: string;
  /** Whether this is a cloned temp directory that should be cleaned up. */
  isClone: boolean;
}

/**
 * Fetch a source repo — clone remote repos, resolve local paths.
 *
 * Returns the path to the source directory and whether it's a temporary
 * clone that should be cleaned up after use.
 */
async function fetchSource(source: string): Promise<FetchSourceResult> {
  const parsed = parseSource(source);

  if (parsed.type === 'local' && parsed.localPath) {
    return { path: resolve(parsed.localPath), isClone: false };
  }

  // Remote source — clone to temp dir
  const clonePath = await cloneRepo(parsed.url, parsed.ref);
  return { path: clonePath, isClone: true };
}
