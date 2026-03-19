import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat, unlink, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { agents, detectInstalledAgents } from './agents.ts';
import { track } from './telemetry.ts';
import { removeSkillFromLock, getSkillFromLock } from './skill-lock.ts';
import type { AgentType, ContextType, LockEntry } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSkillsDir,
  sanitizeName,
} from './skill-installer.ts';
import { readDotaiLock, removeLockEntry, writeDotaiLock } from './dotai-lock.ts';
import { removeSection } from './append-markers.ts';
import { removeFromGitignore } from './gitignore.ts';
import { consumeMultiValues, VALID_CONTEXT_TYPES } from './cli-parse.ts';
import { CommandError } from './command-result.ts';

export interface RemoveOptions {
  global?: boolean;
  agents?: string[];
  yes?: boolean;
  all?: boolean;
  type?: ContextType[];
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  // If --type is specified and includes only rule/prompt/agent (not skill), use dotai-lock removal
  const typeFilter = options.type;
  const onlyDotaiTypes =
    typeFilter &&
    typeFilter.length > 0 &&
    typeFilter.every((t) => t === 'rule' || t === 'prompt' || t === 'agent');

  if (onlyDotaiTypes) {
    await removeDotaiManagedItems(
      skillNames,
      options,
      typeFilter as Array<'rule' | 'prompt' | 'agent'>
    );
    return;
  }

  // If --type includes skill (or no type filter), run the existing skill removal flow
  // and also handle rule/prompt/agent removal if those types are included
  const includesRulesOrPromptsOrAgents =
    typeFilter &&
    (typeFilter.includes('rule') || typeFilter.includes('prompt') || typeFilter.includes('agent'));

  if (includesRulesOrPromptsOrAgents) {
    // Remove dotai-managed items first
    const dotaiTypes = typeFilter.filter(
      (t) => t === 'rule' || t === 'prompt' || t === 'agent'
    ) as Array<'rule' | 'prompt' | 'agent'>;
    await removeDotaiManagedItems(skillNames, options, dotaiTypes);
  }

  // Continue with skill removal (original flow)
  await removeSkills(skillNames, options);
}

async function removeSkills(skillNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills...');
  const skillNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skillNamesSet.add(entry.name);
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    await scanDir(getCanonicalSkillsDir(true, cwd));
    for (const agent of Object.values(agents)) {
      if (agent.globalSkillsDir !== undefined) {
        await scanDir(agent.globalSkillsDir);
      }
    }
  } else {
    await scanDir(getCanonicalSkillsDir(false, cwd));
    for (const agent of Object.values(agents)) {
      await scanDir(join(cwd, agent.skillsDir));
    }
  }

  const installedSkills = Array.from(skillNamesSet).sort();
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  if (installedSkills.length === 0) {
    p.outro(pc.yellow('No skills found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for skill selection
  if (options.agents && options.agents.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agents.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      throw new CommandError(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = installedSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = installedSkills.filter((s) =>
      skillNames.some((name) => name.toLowerCase() === s.toLowerCase())
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    const choices = installedSkills.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select skills to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      throw new CommandError(0);
    }

    selectedSkills = selected as string[];
  }

  let targetAgents: AgentType[];
  if (options.agents && options.agents.length > 0) {
    targetAgents = options.agents as AgentType[];
  } else {
    // When removing, we should target all known agents to ensure
    // ghost symlinks are cleaned up, even if the agent is not detected.
    targetAgents = Object.keys(agents) as AgentType[];
    spinner.stop(`Targeting ${targetAgents.length} potential agent(s)`);
  }

  if (!options.yes) {
    console.log();
    p.log.info('Skills to remove:');
    for (const skill of selectedSkills) {
      p.log.message(`  ${pc.red('•')} ${skill}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedSkills.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      throw new CommandError(0);
    }
  }

  spinner.start('Removing skills...');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

        // Determine potential paths to cleanup. For universal agents, getInstallPath
        // now returns the canonical path, so we also need to check their 'native'
        // directory to clean up any legacy symlinks.
        const pathsToCleanup = new Set([skillPath]);
        const sanitizedName = sanitizeName(skillName);
        if (isGlobal && agent.globalSkillsDir) {
          pathsToCleanup.add(join(agent.globalSkillsDir, sanitizedName));
        } else {
          pathsToCleanup.add(join(cwd, agent.skillsDir, sanitizedName));
        }

        for (const pathToCleanup of pathsToCleanup) {
          // Skip if this is the canonical path - we'll handle that after checking all agents
          if (pathToCleanup === canonicalPath) {
            continue;
          }

          try {
            const stats = await lstat(pathToCleanup).catch(() => null);
            if (stats) {
              await rm(pathToCleanup, { recursive: true, force: true });
            }
          } catch (err) {
            p.log.warn(
              `Could not remove skill from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedAgents = await detectInstalledAgents();
      const remainingAgents = installedAgents.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const path = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const exists = await lstat(path).catch(() => null);
        if (exists) {
          isStillUsed = true;
          break;
        }
      }

      if (!isStillUsed) {
        await rm(canonicalPath, { recursive: true, force: true });
      }

      const lockEntry = isGlobal ? await getSkillFromLock(skillName) : null;
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      if (isGlobal) {
        await removeSkillFromLock(skillName);
      }

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal (grouped by source)
  if (successful.length > 0) {
    const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { skills: [] };
      existing.skills.push(r.skill);
      existing.sourceType = r.sourceType;
      bySource.set(source, existing);
    }

    for (const [source, data] of bySource) {
      track({
        event: 'remove',
        source,
        skills: data.skills.join(','),
        agents: targetAgents.join(','),
        ...(isGlobal && { global: '1' }),
        sourceType: data.sourceType,
      });
    }
  }

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} skill(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} skill(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Parse command line options for the remove command.
 * Separates skill names from options flags.
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--agents') {
      options.agents = options.agents || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.agents.push(...values);
      i = nextIndex - 1;
    } else if (arg === '-t' || arg === '--type') {
      options.type = options.type || [];
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        const { values } = consumeMultiValues([nextArg], 0, { splitCommas: true });
        for (const val of values) {
          const lower = val.toLowerCase();
          if (!VALID_CONTEXT_TYPES.includes(lower as ContextType)) {
            console.log(`${pc.yellow(`Invalid type: ${lower}`)}`);
            console.log(`${pc.dim(`Valid types: ${VALID_CONTEXT_TYPES.join(', ')}`)}`);
            throw new CommandError(1);
          }
          if (!options.type.includes(lower as ContextType)) {
            options.type.push(lower as ContextType);
          }
        }
        i++;
      }
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}

// ---------------------------------------------------------------------------
// Dotai-managed item removal (rules + prompts + agents via .dotai-lock.json)
// ---------------------------------------------------------------------------

/**
 * Remove dotai-managed items (rules, prompts, and/or agents) tracked in `.dotai-lock.json`.
 * Deletes output files and removes entries from the lock file.
 */
async function removeDotaiManagedItems(
  names: string[],
  options: RemoveOptions,
  types: Array<'rule' | 'prompt' | 'agent'>
): Promise<void> {
  const cwd = process.cwd();
  const spinner = p.spinner();

  // Read lock file
  spinner.start('Reading dotai lock file...');
  let lock;
  try {
    const result = await readDotaiLock(cwd);
    lock = result.lock;
  } catch {
    spinner.stop('No dotai lock file found');
    p.outro(pc.yellow('No rules, prompts, or agents found to remove.'));
    return;
  }

  // Filter entries by type
  const typeSet = new Set<string>(types);
  let candidates = lock.items.filter((entry) => typeSet.has(entry.type));

  // Apply agent filter if provided
  if (options.agents && options.agents.length > 0) {
    const agentSet = new Set<string>(options.agents);
    candidates = candidates.filter((entry) => entry.agents.some((a) => agentSet.has(a)));
  }

  candidates.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  spinner.stop(`Found ${candidates.length} ${types.join('/')}(s)`);

  if (candidates.length === 0) {
    const typeLabel = types.join('/');
    p.outro(pc.yellow(`No ${typeLabel}s found to remove.`));
    return;
  }

  // Select items to remove
  let selectedEntries: LockEntry[];

  if (options.all) {
    selectedEntries = candidates;
  } else if (names.length > 0) {
    const nameSet = new Set(names.map((n) => n.toLowerCase()));
    selectedEntries = candidates.filter((e) => nameSet.has(e.name.toLowerCase()));

    if (selectedEntries.length === 0) {
      p.log.error(`No matching items found for: ${names.join(', ')}`);
      return;
    }
  } else {
    // Interactive selection
    const choices = candidates.map((e) => ({
      value: `${e.type}:${e.name}`,
      label: `${e.name} ${pc.dim(`(${e.type})`)}`,
    }));

    const selected = await p.multiselect({
      message: `Select items to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      throw new CommandError(0);
    }

    const selectedKeys = new Set(selected as string[]);
    selectedEntries = candidates.filter((e) => selectedKeys.has(`${e.type}:${e.name}`));
  }

  // Confirm
  if (!options.yes) {
    console.log();
    p.log.info('Items to remove:');
    for (const entry of selectedEntries) {
      p.log.message(`  ${pc.red('•')} ${entry.name} ${pc.dim(`(${entry.type})`)}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to remove ${selectedEntries.length} item(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      throw new CommandError(0);
    }
  }

  // Remove files and lock entries
  spinner.start('Removing items...');

  let removedCount = 0;
  const errors: Array<{ name: string; type: string; error: string }> = [];

  for (const entry of selectedEntries) {
    try {
      // Delete output files (or remove marker sections for append-mode entries)
      if (entry.append) {
        // Append-mode: remove marked sections from target files
        for (const outputPath of entry.outputs) {
          try {
            const existing = await readFile(outputPath, 'utf-8');
            const updated = removeSection(existing, entry.name);
            if (updated.length === 0) {
              // File is empty after removing the section — delete it
              await unlink(outputPath);
            } else {
              await writeFile(outputPath, updated, 'utf-8');
            }
          } catch (err) {
            // File may already be deleted — that's fine
            if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
              throw err;
            }
          }
        }
      } else {
        // Standard mode: delete output files
        for (const outputPath of entry.outputs) {
          try {
            await unlink(outputPath);
          } catch (err) {
            // File may already be deleted — that's fine
            if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
              throw err;
            }
          }
        }
      }

      // Clean up .gitignore if this entry was gitignored
      if (entry.gitignored && entry.outputs.length > 0) {
        await removeFromGitignore(cwd, entry.outputs);
      }

      // Remove from lock
      const result = removeLockEntry(lock, entry.type as ContextType, entry.name);
      lock = result.lock;

      removedCount++;

      track({
        event: 'remove',
        source: entry.source,
        skills: entry.name,
        agents: entry.agents.join(','),
        sourceType: entry.type,
      });
    } catch (err) {
      errors.push({
        name: entry.name,
        type: entry.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Write updated lock file
  await writeDotaiLock(lock, cwd);

  spinner.stop('Removal complete');

  if (removedCount > 0) {
    p.log.success(pc.green(`Successfully removed ${removedCount} item(s)`));
  }

  if (errors.length > 0) {
    p.log.error(pc.red(`Failed to remove ${errors.length} item(s)`));
    for (const e of errors) {
      p.log.message(`  ${pc.red('✗')} ${e.name} (${e.type}): ${e.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}
