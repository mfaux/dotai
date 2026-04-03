import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalAgents } from './agents.ts';
import { readDotaiLock, getLockEntriesByType } from './dotai-lock.ts';
import { addPrompts, addAgents } from './context-add.ts';
import { parseSource } from './source-parser.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import type { LockEntry, TargetAgent } from './types.ts';

/**
 * Install all context from lock files:
 * - Skills from skills-lock.json
 * - Prompts and agents from .dotai-lock.json
 *
 * Groups items by source and calls the appropriate installer for each group.
 * Skills install to .agents/skills/ (universal agents).
 * Prompts and agents install to agent-specific directories.
 *
 * node_modules skills are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // --- Phase 1: Restore skills from skills-lock.json ---
  const skillsFound = await restoreSkills(cwd, args);

  // --- Phase 2: Restore prompts and agents from .dotai-lock.json ---
  const contextFound = await restoreCanonicalEntries(cwd);

  // If nothing was found in either lock file, inform the user
  if (!skillsFound && !contextFound) {
    p.log.warn('No project skills found in skills-lock.json');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx dotai add <package>')} (without ${pc.cyan('-g')})`
    );
  }
}

/**
 * Restore skills from skills-lock.json.
 * Returns true if any skills were found in the lock file.
 */
async function restoreSkills(cwd: string, args: string[]): Promise<boolean> {
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    return false;
  }

  // Only install to .agents/skills/ (universal agents)
  const universalAgentNames = getUniversalAgents();

  // Separate node_modules skills from remote skills
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, { sourceType: string; skills: string[] }>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    const existing = bySource.get(entry.source);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(entry.source, {
        sourceType: entry.sourceType,
        skills: [skillName],
      });
    }
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
    );
  }

  // Install remote skills grouped by source
  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        skill: skills,
        targets: universalAgentNames,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      const { options: syncOptions } = parseSyncOptions(args);
      await runSync(args, { ...syncOptions, yes: true, targets: universalAgentNames });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return true;
}

/**
 * Restore prompts and agents from .dotai-lock.json.
 *
 * Groups entries by source so each repo is cloned only once.
 * Calls addPrompts/addAgents for each source group, then cleans up temp dirs.
 * Returns true if any prompts or agents were found in the lock file.
 */
async function restoreCanonicalEntries(cwd: string): Promise<boolean> {
  const { lock } = await readDotaiLock(cwd);

  const promptEntries = getLockEntriesByType(lock, 'prompt');
  const agentEntries = getLockEntriesByType(lock, 'agent');

  if (promptEntries.length === 0 && agentEntries.length === 0) {
    return false;
  }

  const totalCount = promptEntries.length + agentEntries.length;
  p.log.info(
    `Restoring ${pc.cyan(String(totalCount))} ${describeTypes(promptEntries.length, agentEntries.length)} from .dotai-lock.json`
  );

  // Group all entries by source
  const bySource = groupBySource([...promptEntries, ...agentEntries]);

  for (const [source, entries] of bySource) {
    let tempDir: string | undefined;

    try {
      // Parse and clone the source repo
      const parsed = parseSource(source);

      if (parsed.type === 'local') {
        // Local sources don't need cloning
        tempDir = undefined;
        const sourcePath = parsed.localPath!;

        await installFromSource(source, sourcePath, cwd, entries);
      } else {
        // Clone remote repo
        tempDir = await cloneRepo(parsed.url, parsed.ref);
        const sourcePath = parsed.subpath ? `${tempDir}/${parsed.subpath}` : tempDir;

        await installFromSource(source, sourcePath, cwd, entries);
      }
    } catch (error) {
      p.log.error(
        `Failed to restore from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      // Clean up temp directory
      if (tempDir) {
        try {
          await cleanupTempDir(tempDir);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  return true;
}

/**
 * Install prompts and agents from a single source path.
 *
 * Respects the `gitignored` flag from lock entries: entries that were
 * originally installed with `--gitignore` are restored with the same flag
 * so `.gitignore` is re-populated on restore.
 *
 * When a source has a mix of gitignored and non-gitignored entries of the
 * same type, they are installed in separate calls to preserve per-entry state.
 */
async function installFromSource(
  source: string,
  sourcePath: string,
  projectRoot: string,
  entries: LockEntry[]
): Promise<void> {
  // Partition entries by type and gitignored status
  const promptEntries = entries.filter((e) => e.type === 'prompt');
  const agentEntries = entries.filter((e) => e.type === 'agent');

  // Install prompts — split by gitignored status if needed
  await installGroup(promptEntries, 'prompt', source, sourcePath, projectRoot);

  // Install agents — split by gitignored status if needed
  await installGroup(agentEntries, 'agent', source, sourcePath, projectRoot);
}

/**
 * Install a group of same-type entries, splitting by gitignored and append status.
 *
 * Append-mode and per-file mode rules must be installed in separate calls because
 * the `append` flag changes how transpilers emit output. Similarly, gitignored and
 * non-gitignored entries need separate calls to preserve the --gitignore flag.
 *
 * This produces up to 4 buckets: {gitignored, append} combinations.
 */
async function installGroup(
  entries: LockEntry[],
  type: 'prompt' | 'agent',
  source: string,
  sourcePath: string,
  projectRoot: string
): Promise<void> {
  if (entries.length === 0) return;

  // Partition into up to 4 buckets by {gitignored, append}
  const buckets = [
    { gitignore: false, append: false, items: entries.filter((e) => !e.gitignored && !e.append) },
    { gitignore: false, append: true, items: entries.filter((e) => !e.gitignored && e.append) },
    { gitignore: true, append: false, items: entries.filter((e) => e.gitignored && !e.append) },
    { gitignore: true, append: true, items: entries.filter((e) => e.gitignored && e.append) },
  ];

  for (const bucket of buckets) {
    if (bucket.items.length > 0) {
      await installEntries(
        bucket.items,
        type,
        source,
        sourcePath,
        projectRoot,
        bucket.gitignore,
        bucket.append
      );
    }
  }
}

/**
 * Install entries of a single type with specific gitignore and append modes.
 *
 * Computes the union of `agents` arrays from all entries in the batch so items
 * are only transpiled to agents they were originally installed for.
 */
async function installEntries(
  entries: LockEntry[],
  type: 'prompt' | 'agent',
  source: string,
  sourcePath: string,
  projectRoot: string,
  gitignore: boolean,
  append: boolean
): Promise<void> {
  const names = entries.map((e) => e.name);

  // Compute the union of agents from all entries in this batch
  const agents = [...new Set(entries.flatMap((e) => e.agents))] as TargetAgent[];

  if (type === 'prompt') {
    const result = await addPrompts({
      source,
      sourcePath,
      projectRoot,
      promptNames: names,
      force: true, // Overwrite existing — we're restoring from lock
      gitignore,
      targets: agents,
    });

    for (const msg of result.messages) {
      p.log.message(msg);
    }

    if (result.success) {
      p.log.success(
        `Restored ${pc.cyan(String(result.promptsInstalled))} prompt${result.promptsInstalled !== 1 ? 's' : ''} from ${pc.dim(source)}`
      );
    } else if (result.error) {
      p.log.error(`Prompts from ${pc.cyan(source)}: ${result.error}`);
    }
  } else {
    const result = await addAgents({
      source,
      sourcePath,
      projectRoot,
      agentNames: names,
      force: true, // Overwrite existing — we're restoring from lock
      gitignore,
      targets: agents,
    });

    for (const msg of result.messages) {
      p.log.message(msg);
    }

    if (result.success) {
      p.log.success(
        `Restored ${pc.cyan(String(result.agentsInstalled))} agent${result.agentsInstalled !== 1 ? 's' : ''} from ${pc.dim(source)}`
      );
    } else if (result.error) {
      p.log.error(`Agents from ${pc.cyan(source)}: ${result.error}`);
    }
  }
}

/**
 * Group lock entries by their source field.
 */
function groupBySource(entries: LockEntry[]): Map<string, LockEntry[]> {
  const grouped = new Map<string, LockEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.source);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(entry.source, [entry]);
    }
  }
  return grouped;
}

/**
 * Describe the types being restored for human-readable output.
 */
function describeTypes(promptCount: number, agentCount: number): string {
  const parts: string[] = [];
  if (promptCount > 0) parts.push(`prompt${promptCount !== 1 ? 's' : ''}`);
  if (agentCount > 0) parts.push(`agent${agentCount !== 1 ? 's' : ''}`);
  return parts.join(', ').replace(/, ([^,]+)$/, ' and $1');
}
