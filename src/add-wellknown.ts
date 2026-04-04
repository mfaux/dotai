import * as p from '@clack/prompts';
import pc from 'picocolors';
import { isSourcePrivate } from './lib/parsers/index.ts';
import { shortenPath, formatList } from './utils.ts';
import { getCanonicalPath, installWellKnownSkillForAgent } from './lib/install/index.ts';
import { agents } from './agents.ts';
import { track } from './telemetry.ts';
import { wellKnownProvider, type WellKnownSkill } from './providers/index.ts';
import { addSkillToLock } from './lib/lock/index.ts';
import { addSkillToLocalLock, computeSkillFolderHash } from './lib/lock/index.ts';
import type { AgentType } from './types.ts';
import { buildAgentSummaryLines } from './add-display.ts';
import type { AddOptions } from './add-options.ts';
import { multiselect } from './add-agents.ts';
import { CommandError } from './command-result.ts';
import {
  resolveInstallTargets,
  checkOverwrites,
  displayInstallResults,
  type InstallResult,
} from './add-install.ts';

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 * Discovers skills from /.well-known/skills/index.json
 */
export async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>,
  onComplete?: (options: AddOptions, targetAgents: AgentType[]) => Promise<void>
): Promise<void> {
  spinner.start('Discovering skills from well-known endpoint...');

  // Fetch all skills from the well-known endpoint
  const skills = await wellKnownProvider.fetchAllSkills(url);

  if (skills.length === 0) {
    spinner.stop(pc.red('No skills found'));
    p.outro(
      pc.red(
        'No skills found at this URL. Make sure the server has a /.well-known/skills/index.json file.'
      )
    );
    throw new CommandError(1);
  }

  spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  // Log discovered skills
  for (const skill of skills) {
    p.log.info(`Skill: ${pc.cyan(skill.installName)}`);
    p.log.message(pc.dim(skill.description));
    if (skill.files.size > 1) {
      p.log.message(pc.dim(`  Files: ${Array.from(skill.files.keys()).join(', ')}`));
    }
  }

  // Filter skills if --skill option is provided
  let selectedSkills: WellKnownSkill[];

  if (options.skill?.includes('*')) {
    // --skill '*' selects all skills
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter((s) =>
      options.skill!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
      p.log.info('Available skills:');
      for (const s of skills) {
        p.log.message(`  - ${s.installName}`);
      }
      throw new CommandError(1);
    }
  } else if (skills.length === 1) {
    selectedSkills = skills;
    const firstSkill = skills[0]!;
    p.log.info(`Skill: ${pc.cyan(firstSkill.installName)}`);
  } else if (options.yes) {
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else {
    // Prompt user to select skills
    const skillChoices = skills.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));

    const selected = await multiselect({
      message: 'Select skills to install',
      options: skillChoices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Installation cancelled');
      throw new CommandError(0);
    }

    selectedSkills = selected as WellKnownSkill[];
  }

  // Resolve agents, scope, and install mode
  const targets = await resolveInstallTargets(options, spinner);

  if (!targets) {
    throw new CommandError(0);
  }

  const { targetAgents, installGlobally, installMode } = targets;

  const cwd = process.cwd();

  if (options.dryRun) {
    p.log.info(pc.dim('Dry run — no files will be written'));
  }

  // Build installation summary
  const summaryLines: string[] = [];

  // Check if any skill will be overwritten (parallel)
  const overwriteStatus = await checkOverwrites(
    selectedSkills.map((s) => ({ name: s.installName })),
    targetAgents,
    installGlobally
  );

  for (const skill of selectedSkills) {
    if (summaryLines.length > 0) summaryLines.push('');

    const canonicalPath = getCanonicalPath(skill.installName, { global: installGlobally });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(shortCanonical)}`);
    summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));
    if (skill.files.size > 1) {
      summaryLines.push(`  ${pc.dim('files:')} ${skill.files.size}`);
    }

    const skillOverwrites = overwriteStatus.get(skill.installName);
    const overwriteAgents = targetAgents
      .filter((a) => skillOverwrites?.get(a))
      .map((a) => agents[a].displayName);

    if (overwriteAgents.length > 0) {
      summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
    }
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes && !options.dryRun) {
    const confirmed = await p.confirm({ message: 'Proceed with installation?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      throw new CommandError(0);
    }
  }

  if (options.dryRun) {
    console.log();
    p.note(
      [
        pc.dim('Dry run — no files were written'),
        `${pc.cyan(String(selectedSkills.length))} skill${selectedSkills.length !== 1 ? 's' : ''} would be installed`,
      ].join('\n'),
      'Dry Run Summary'
    );

    console.log();
    p.outro(pc.green('Dry run complete'));
    return;
  }

  spinner.start('Installing skills...');

  const results: InstallResult[] = [];

  for (const skill of selectedSkills) {
    for (const agent of targetAgents) {
      const result = await installWellKnownSkillForAgent(skill, agent, {
        global: installGlobally,
        mode: installMode,
      });
      results.push({
        skill: skill.installName,
        agent: agents[agent].displayName,
        ...result,
      });
    }
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);

  // Track installation
  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);

  // Build skillFiles map: { skillName: sourceUrl }
  const skillFiles: Record<string, string> = {};
  for (const skill of selectedSkills) {
    skillFiles[skill.installName] = skill.sourceUrl;
  }

  // Skip telemetry for private GitHub repos
  const isPrivate = await isSourcePrivate(sourceIdentifier);
  if (isPrivate !== true) {
    // Only send telemetry if repo is public (isPrivate === false) or we can't determine (null for non-GitHub sources)
    track({
      event: 'install',
      source: sourceIdentifier,
      skills: selectedSkills.map((s) => s.installName).join(','),
      agents: targetAgents.join(','),
      ...(installGlobally && { global: '1' }),
      skillFiles: JSON.stringify(skillFiles),
      sourceType: 'well-known',
    });
  }

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          await addSkillToLock(skill.installName, {
            source: sourceIdentifier,
            sourceType: 'well-known',
            sourceUrl: skill.sourceUrl,
            skillFolderHash: '', // Well-known skills don't have a folder hash
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  // Add to local lock file for project-scoped installs
  if (successful.length > 0 && !installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          const matchingResult = successful.find((r) => r.skill === skill.installName);
          const installDir = matchingResult?.canonicalPath || matchingResult?.path;
          if (installDir) {
            const computedHash = await computeSkillFolderHash(installDir);
            await addSkillToLocalLock(
              skill.installName,
              {
                source: sourceIdentifier,
                sourceType: 'well-known',
                computedHash,
              },
              cwd
            );
          }
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  displayInstallResults(results, targetAgents, cwd);

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );

  // Prompt for find-skills after successful install
  if (onComplete) {
    await onComplete(options, targetAgents);
  }
}
