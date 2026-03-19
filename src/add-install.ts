import * as p from '@clack/prompts';
import pc from 'picocolors';
import { promptForAgents, selectAgentsInteractive } from './add-agents.ts';
import { isSkillInstalled, type InstallMode } from './skill-installer.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import type { AgentType } from './types.ts';
import { ensureUniversalAgents, buildResultLines } from './add-display.ts';
import type { AddOptions } from './add-options.ts';
import { shortenPath, formatList, kebabToTitle } from './utils.ts';
import { CommandError } from './command-result.ts';

export interface InstallResult {
  skill: string;
  agent: string;
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
  pluginName?: string;
}

export interface InstallTargets {
  targetAgents: AgentType[];
  installGlobally: boolean;
  installMode: InstallMode;
}

/**
 * Resolves agent selection, installation scope, and install mode from CLI
 * options and interactive prompts. Returns `null` when the user cancels.
 *
 * Shared by `runAdd` (git-based skills) and `handleWellKnownSkills`.
 */
export async function resolveInstallTargets(
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<InstallTargets | null> {
  // ── Agent selection ──

  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agents?.includes('*')) {
    // --agents '*' selects all agents
    targetAgents = validAgents as AgentType[];
    p.log.info(`Installing to all ${targetAgents.length} agents`);
  } else if (options.agents && options.agents.length > 0) {
    const invalidAgents = options.agents.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      throw new CommandError(1);
    }

    targetAgents = options.agents as AgentType[];
  } else {
    spinner.start('Loading agents...');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents');
      } else {
        p.log.info('Select agents to install skills to');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
          label: config.displayName,
        }));

        // Use helper to prompt with search
        const selected = await promptForAgents(
          'Which agents do you want to install to?',
          allAgentChoices
        );

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          return null;
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      // Auto-select detected agents + ensure universal agents are included
      targetAgents = ensureUniversalAgents(installedAgents);
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive({ global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        return null;
      }

      targetAgents = selected as AgentType[];
    }
  }

  // ── Installation scope ──

  let installGlobally = options.global ?? false;

  // Check if any selected agents support global installation
  const supportsGlobal = targetAgents.some((a) => agents[a].globalSkillsDir !== undefined);

  if (options.global === undefined && !options.yes && supportsGlobal) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });

    if (p.isCancel(scope)) {
      p.cancel('Installation cancelled');
      return null;
    }

    installGlobally = scope as boolean;
  }

  // ── Install mode ──

  let installMode: InstallMode = options.copy ? 'copy' : 'symlink';

  if (!options.copy && !options.yes) {
    const modeChoice = await p.select({
      message: 'Installation method',
      options: [
        {
          value: 'symlink',
          label: 'Symlink (Recommended)',
          hint: 'Single source of truth, easy updates',
        },
        { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Installation cancelled');
      return null;
    }

    installMode = modeChoice as InstallMode;
  }

  return { targetAgents, installGlobally, installMode };
}

/**
 * Checks which skill × agent combinations already have an installed skill.
 *
 * Returns a nested map: `skillName → agentType → isInstalled`.
 *
 * Shared by `runAdd` (git-based skills) and `handleWellKnownSkills`.
 */
export async function checkOverwrites(
  skills: Array<{ name: string }>,
  targetAgents: AgentType[],
  installGlobally: boolean
): Promise<Map<string, Map<string, boolean>>> {
  const checks = await Promise.all(
    skills.flatMap((skill) =>
      targetAgents.map(async (agent) => ({
        skillName: skill.name,
        agent,
        installed: await isSkillInstalled(skill.name, agent, { global: installGlobally }),
      }))
    )
  );

  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const { skillName, agent, installed } of checks) {
    if (!overwriteStatus.has(skillName)) {
      overwriteStatus.set(skillName, new Map());
    }
    overwriteStatus.get(skillName)!.set(agent, installed);
  }

  return overwriteStatus;
}

/**
 * Displays installation results: groups by skill (and optionally by plugin),
 * shows copy/symlink paths, symlink failure warnings, and failed installations.
 *
 * Shared by `runAdd` (git-based skills) and `handleWellKnownSkills`.
 */
export function displayInstallResults(
  results: InstallResult[],
  targetAgents: AgentType[],
  cwd: string
): void {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const bySkill = new Map<string, InstallResult[]>();

    // Group results by plugin name
    const groupedResults: Record<string, InstallResult[]> = {};
    const ungroupedResults: InstallResult[] = [];

    for (const r of successful) {
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);

      // Only track one entry per skill for the group loop
      if (skillResults.length === 1) {
        if (r.pluginName) {
          const group = r.pluginName;
          if (!groupedResults[group]) groupedResults[group] = [];
          groupedResults[group].push(r);
        } else {
          ungroupedResults.push(r);
        }
      }
    }

    const skillCount = bySkill.size;
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    const copiedAgents = symlinkFailures.map((r) => r.agent);
    const resultLines: string[] = [];

    const printSkillResults = (entries: InstallResult[]) => {
      for (const entry of entries) {
        const skillResults = bySkill.get(entry.skill) || [];
        const firstResult = skillResults[0]!;

        if (firstResult.mode === 'copy') {
          // Copy mode: show skill name and list all agent paths
          resultLines.push(`${pc.green('✓')} ${entry.skill} ${pc.dim('(copied)')}`);
          for (const r of skillResults) {
            const shortPath = shortenPath(r.path, cwd);
            resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
          }
        } else {
          // Symlink mode: show canonical path and universal/symlinked agents
          if (firstResult.canonicalPath) {
            const shortPath = shortenPath(firstResult.canonicalPath, cwd);
            resultLines.push(`${pc.green('✓')} ${shortPath}`);
          } else {
            resultLines.push(`${pc.green('✓')} ${entry.skill}`);
          }
          resultLines.push(...buildResultLines(skillResults, targetAgents));
        }
      }
    };

    // Print grouped results
    const sortedResultGroups = Object.keys(groupedResults).sort();

    for (const group of sortedResultGroups) {
      const title = kebabToTitle(group);

      resultLines.push('');
      resultLines.push(pc.bold(title));
      printSkillResults(groupedResults[group]!);
    }

    if (ungroupedResults.length > 0) {
      if (sortedResultGroups.length > 0) {
        resultLines.push('');
        resultLines.push(pc.bold('General'));
      }
      printSkillResults(ungroupedResults);
    }

    const title = pc.green(`Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning (only for symlink mode)
    if (symlinkFailures.length > 0) {
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
      p.log.message(
        pc.dim(
          '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
        )
      );
    }
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }
}
