import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { sep } from 'path';
import { parseSource, getOwnerRepo, parseOwnerRepo, isRepoPrivate } from './source-parser.ts';
import { shortenPath, formatList, kebabToTitle } from './utils.ts';
import { multiselect } from './add-agents.ts';
export { promptForAgents } from './add-agents.ts';
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { CommandError } from './command-result.ts';
import {
  addRules,
  addPrompts,
  addAgents,
  addInstructions,
  resolveTargetAgents,
} from './rule-add.ts';
import { TARGET_AGENTS } from './target-agents.ts';
import { discoverSkills, getSkillDisplayName, filterSkills } from './skill-discovery.ts';
import { discover } from './rule-discovery.ts';
import { installSkillForAgent, isSkillInstalled, getCanonicalPath } from './skill-installer.ts';
import { agents } from './agents.ts';
import { track, setVersion, fetchAuditData } from './telemetry.ts';
import { handleWellKnownSkills } from './add-wellknown.ts';
import {
  addSkillToLock,
  fetchSkillFolderHash,
  isPromptDismissed,
  dismissPrompt,
} from './skill-lock.ts';
import { addSkillToLocalLock, computeSkillFolderHash } from './local-lock.ts';
import type { Skill, AgentType, TargetAgent, ContextType } from './types.ts';
import { parseAddOptions, type AddOptions } from './add-options.ts';
export { parseAddOptions, type AddOptions } from './add-options.ts';
import packageJson from '../package.json' with { type: 'json' };
import { buildSecurityLines, buildAgentSummaryLines } from './add-display.ts';
import {
  resolveInstallTargets,
  checkOverwrites,
  displayInstallResults,
  type InstallResult,
} from './add-install.ts';
export function initTelemetry(version: string): void {
  setVersion(version);
}

const version = packageJson.version;
setVersion(version);

/**
 * Resolve transpilation target agents from --targets flag, or default to all four.
 *
 * When --targets is used for transpilation (rules/prompts/agents), values are
 * resolved as TargetAgent names or aliases (copilot, claude, cursor).
 *
 * Throws CommandError if invalid or no valid targets are specified.
 */
function resolveAgentsOrDefault(options: AddOptions): TargetAgent[] {
  if (options.targets && options.targets.length > 0) {
    const { agents: resolved, invalid } = resolveTargetAgents(options.targets);

    if (invalid.length > 0) {
      p.log.error(`Invalid targets: ${invalid.join(', ')}`);
      p.log.info(`Valid targets: ${TARGET_AGENTS.join(', ')}`);
      p.log.info(`Aliases: copilot, claude, cursor`);
      throw new CommandError(1);
    }

    if (resolved.length === 0) {
      p.log.error('No valid targets specified');
      throw new CommandError(1);
    }

    return resolved;
  }

  return [...TARGET_AGENTS];
}

/** Config for each context type handled by handleContextInstall. */
interface ContextInstallConfig {
  /** Noun used in log/spinner messages (e.g., "rule", "prompt", "agent"). */
  noun: string;
  /** Extract item names from options. */
  getNames: (options: AddOptions) => string[];
  /** Run the install pipeline and return a normalized result. */
  install: (params: {
    source: string;
    sourcePath: string;
    projectRoot: string;
    names: string[];
    agents: TargetAgent[];
    options: AddOptions;
  }) => Promise<{
    success: boolean;
    itemsInstalled: number;
    writtenPaths: string[];
    messages: string[];
    error?: string;
  }>;
}

const CONTEXT_CONFIGS: Record<'rule' | 'prompt' | 'agent' | 'instruction', ContextInstallConfig> = {
  rule: {
    noun: 'rule',
    getNames: (opts) => opts.rule ?? [],
    install: async ({ source, sourcePath, projectRoot, names, agents, options }) => {
      const result = await addRules({
        source,
        sourcePath,
        projectRoot,
        ruleNames: names,
        targets: agents,
        dryRun: options.dryRun,
        force: options.force,
        append: options.append,
        gitignore: options.gitignore,
      });
      return { ...result, itemsInstalled: result.rulesInstalled };
    },
  },
  prompt: {
    noun: 'prompt',
    getNames: (opts) => opts.prompt ?? [],
    install: async ({ source, sourcePath, projectRoot, names, agents, options }) => {
      const result = await addPrompts({
        source,
        sourcePath,
        projectRoot,
        promptNames: names,
        targets: agents,
        dryRun: options.dryRun,
        force: options.force,
        gitignore: options.gitignore,
      });
      return { ...result, itemsInstalled: result.promptsInstalled };
    },
  },
  agent: {
    noun: 'agent',
    getNames: (opts) => opts.customAgent ?? [],
    install: async ({ source, sourcePath, projectRoot, names, agents, options }) => {
      const result = await addAgents({
        source,
        sourcePath,
        projectRoot,
        agentNames: names,
        targets: agents,
        dryRun: options.dryRun,
        force: options.force,
        gitignore: options.gitignore,
      });
      return { ...result, itemsInstalled: result.agentsInstalled };
    },
  },
  instruction: {
    noun: 'instruction',
    getNames: (opts) => opts.instruction ?? [],
    install: async ({ source, sourcePath, projectRoot, names, agents, options }) => {
      const result = await addInstructions({
        source,
        sourcePath,
        projectRoot,
        instructionNames: names,
        targets: agents,
        dryRun: options.dryRun,
        force: options.force,
        gitignore: options.gitignore,
      });
      return { ...result, itemsInstalled: result.instructionsInstalled };
    },
  },
};

/**
 * Generic handler for rule, prompt, and agent install flows.
 *
 * Resolves `--targets` names to TargetAgent[], runs the appropriate discovery →
 * transpile → install pipeline, and displays results using @clack/prompts.
 */
async function handleContextInstall(
  contextType: 'rule' | 'prompt' | 'agent' | 'instruction',
  source: string,
  skillsDir: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  const config = CONTEXT_CONFIGS[contextType];
  const { noun } = config;
  const capitalNoun = noun.charAt(0).toUpperCase() + noun.slice(1);

  // 1. Resolve target agents from --targets flag (or default to all five)
  const targetAgents = resolveAgentsOrDefault(options);
  p.log.info(`Targets: ${targetAgents.map((a) => pc.cyan(a)).join(', ')}`);

  // 2. Run install pipeline
  const names = config.getNames(options);
  const projectRoot = process.cwd();

  if (options.dryRun) {
    p.log.info(pc.dim('Dry run — no files will be written'));
  }

  spinner.start(`Discovering and installing ${noun}s...`);

  const result = await config.install({
    source,
    sourcePath: skillsDir,
    projectRoot,
    names,
    agents: targetAgents,
    options,
  });

  spinner.stop(
    result.success ? `${capitalNoun} installation complete` : `${capitalNoun} installation failed`
  );

  // 3. Display messages (warnings, skipped items, collision info)
  for (const msg of result.messages) {
    p.log.message(msg);
  }

  // 4. Display results
  if (result.success) {
    const resultLines: string[] = [];

    if (options.dryRun) {
      resultLines.push(pc.dim('Dry run — no files were written'));
      resultLines.push(`${pc.cyan(String(result.itemsInstalled))} ${noun}(s) would be installed`);
    } else {
      resultLines.push(`${pc.green(String(result.itemsInstalled))} ${noun}(s) installed`);
      for (const writtenPath of result.writtenPaths) {
        const shortPath = shortenPath(writtenPath, projectRoot);
        resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
      }
    }

    if (resultLines.length > 0) {
      p.note(
        resultLines.join('\n'),
        options.dryRun ? 'Dry Run Summary' : `${capitalNoun}s Installed`
      );
    }
  } else {
    p.log.error(pc.red(result.error ?? `${capitalNoun} installation failed`));
  }
}

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  const showInstallTip = (): void => {
    if (installTipShown) return;
    p.log.message(
      pc.dim('Tip: use the --yes (-y) and --global (-g) flags to install without prompts.')
    );
    installTipShown = true;
  };

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(`    ${pc.cyan('npx dotai add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx dotai add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    console.log();
    throw new CommandError(1);
  }

  // --all implies --skill '*' and --targets '*' and -y
  if (options.all) {
    options.skill = ['*'];
    options.targets = ['*'];
    options.yes = true;
  }

  // --type expands into the corresponding type-specific options.
  // For each requested type, if the user hasn't already specified explicit names
  // via --rule/--prompt/--custom-agent/--skill, set them to ['*'] (discover all).
  if (options.type && options.type.length > 0) {
    const validTypes: ContextType[] = ['skill', 'rule', 'prompt', 'agent', 'instruction'];
    const invalidTypes = options.type.filter((t) => !validTypes.includes(t));

    if (invalidTypes.length > 0) {
      console.log();
      console.log(
        pc.bgRed(pc.white(pc.bold(' ERROR '))) +
          ' ' +
          pc.red(`Invalid context type(s): ${invalidTypes.join(', ')}`)
      );
      console.log(pc.dim(`  Valid types: ${validTypes.join(', ')}`));
      console.log();
      throw new CommandError(1);
    }

    const requestedTypes = new Set(options.type);

    if (requestedTypes.has('rule') && (!options.rule || options.rule.length === 0)) {
      options.rule = ['*'];
    }
    if (requestedTypes.has('prompt') && (!options.prompt || options.prompt.length === 0)) {
      options.prompt = ['*'];
    }
    if (requestedTypes.has('agent') && (!options.customAgent || options.customAgent.length === 0)) {
      options.customAgent = ['*'];
    }
    if (
      requestedTypes.has('instruction') &&
      (!options.instruction || options.instruction.length === 0)
    ) {
      options.instruction = ['*'];
    }
    if (requestedTypes.has('skill') && (!options.skill || options.skill.length === 0)) {
      options.skill = ['*'];
    }

    // When --type is used, suppress types that were NOT requested.
    // Without this, the default skill flow would always run.
    if (!requestedTypes.has('skill')) {
      // Mark that skills should be skipped unless explicitly requested via --skill
      if (!options.skill || options.skill.length === 0) {
        options.skill = undefined;
      }
    }
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' dotai ')));

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    // Handle well-known skills from arbitrary URLs
    if (parsed.type === 'well-known') {
      await handleWellKnownSkills(source, parsed.url, options, spinner, promptForFindSkills);
      return;
    }

    let skillsDir: string;

    if (parsed.type === 'local') {
      // Use local path directly, no cloning needed
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        throw new CommandError(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      // Clone repository for remote sources
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    // If skillFilter is present from @skill syntax (e.g., owner/repo@skill-name),
    // merge it into options.skill
    if (parsed.skillFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.skillFilter)) {
        options.skill.push(parsed.skillFilter);
      }
    }

    // ─── Rule install flow (--rule flag) ───
    // When --rule is specified, run the dotai rule transpilation pipeline.
    // This is separate from the skill flow and uses discovery + transpilers + collision detection.
    if (options.rule && options.rule.length > 0) {
      await handleContextInstall('rule', source, skillsDir, options, spinner);

      // If no --skill, --prompt, --custom-agent, or --instruction flag was also specified, we're done after rule install
      if (
        (!options.skill || options.skill.length === 0) &&
        (!options.prompt || options.prompt.length === 0) &&
        (!options.customAgent || options.customAgent.length === 0) &&
        (!options.instruction || options.instruction.length === 0)
      ) {
        await cleanup(tempDir);
        return;
      }
    }

    // ─── Prompt install flow (--prompt flag) ───
    // When --prompt is specified, run the dotai prompt transpilation pipeline.
    // This is separate from the skill flow and uses discovery + transpilers + collision detection.
    if (options.prompt && options.prompt.length > 0) {
      await handleContextInstall('prompt', source, skillsDir, options, spinner);

      // If no --skill, --custom-agent, or --instruction flag was also specified, we're done after prompt install
      if (
        (!options.skill || options.skill.length === 0) &&
        (!options.customAgent || options.customAgent.length === 0) &&
        (!options.instruction || options.instruction.length === 0)
      ) {
        await cleanup(tempDir);
        return;
      }
    }

    // ─── Agent install flow (--custom-agent flag) ───
    // When --custom-agent is specified, run the dotai agent transpilation pipeline.
    // This is separate from the skill flow and uses discovery + transpilers + collision detection.
    if (options.customAgent && options.customAgent.length > 0) {
      await handleContextInstall('agent', source, skillsDir, options, spinner);

      // If no --skill or --instruction flag was also specified, we're done after agent install
      if (
        (!options.skill || options.skill.length === 0) &&
        (!options.instruction || options.instruction.length === 0)
      ) {
        await cleanup(tempDir);
        return;
      }
    }

    // ─── Instruction install flow (--instruction flag) ───
    // When --instruction is specified, run the dotai instruction transpilation pipeline.
    // Instructions use append mode — all outputs go to project-wide files.
    if (options.instruction && options.instruction.length > 0) {
      await handleContextInstall('instruction', source, skillsDir, options, spinner);

      // If no --skill flag was also specified, we're done after instruction install
      if (!options.skill || options.skill.length === 0) {
        await cleanup(tempDir);
        return;
      }
    }

    // ─── Zero-flag unified discovery (Phase 3) ───
    // When no type-specific flags are set, discover all content types and present
    // a unified interactive selection grouped by type.
    const hasTypeFlags =
      (options.skill && options.skill.length > 0) ||
      (options.rule && options.rule.length > 0) ||
      (options.prompt && options.prompt.length > 0) ||
      (options.customAgent && options.customAgent.length > 0) ||
      (options.instruction && options.instruction.length > 0);

    if (!hasTypeFlags) {
      spinner.start('Discovering context...');

      // Run both discovery engines in parallel
      const [fullResult, skills] = await Promise.all([
        discover(skillsDir),
        discoverSkills(skillsDir, parsed.subpath, {
          includeInternal: false,
          fullDepth: options.fullDepth,
        }),
      ]);

      const rules = fullResult.items.filter((i) => i.type === 'rule');
      const prompts = fullResult.items.filter((i) => i.type === 'prompt');
      const customAgents = fullResult.items.filter((i) => i.type === 'agent');
      const instructions = fullResult.items.filter((i) => i.type === 'instruction');

      const hasNonSkillContent =
        rules.length + prompts.length + customAgents.length + instructions.length > 0;

      // If non-skill content exists, present unified selection
      if (hasNonSkillContent && skills.length > 0 && !options.yes && process.stdin.isTTY) {
        const totalItems =
          skills.length + rules.length + prompts.length + customAgents.length + instructions.length;
        spinner.stop(`Found ${pc.green(String(totalItems))} item${totalItems !== 1 ? 's' : ''}`);

        // Build grouped options for groupMultiselect
        const grouped: Record<string, p.Option<{ name: string; type: string }>[]> = {};

        if (skills.length > 0) {
          grouped[`Skills (${skills.length})`] = skills.map((s) => ({
            value: { name: getSkillDisplayName(s), type: 'skill' },
            label: getSkillDisplayName(s),
            hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
          }));
        }
        if (rules.length > 0) {
          grouped[`Rules (${rules.length})`] = rules.map((r) => ({
            value: { name: r.name, type: 'rule' },
            label: r.name,
            hint: r.description.length > 60 ? r.description.slice(0, 57) + '...' : r.description,
          }));
        }
        if (prompts.length > 0) {
          grouped[`Prompts (${prompts.length})`] = prompts.map((pr) => ({
            value: { name: pr.name, type: 'prompt' },
            label: pr.name,
            hint: pr.description.length > 60 ? pr.description.slice(0, 57) + '...' : pr.description,
          }));
        }
        if (customAgents.length > 0) {
          grouped[`Agents (${customAgents.length})`] = customAgents.map((a) => ({
            value: { name: a.name, type: 'agent' },
            label: a.name,
            hint: a.description.length > 60 ? a.description.slice(0, 57) + '...' : a.description,
          }));
        }
        if (instructions.length > 0) {
          grouped[`Instructions (${instructions.length})`] = instructions.map((instr) => ({
            value: { name: instr.name, type: 'instruction' },
            label: instr.name,
            hint:
              instr.description.length > 60
                ? instr.description.slice(0, 57) + '...'
                : instr.description,
          }));
        }

        const selected = await p.groupMultiselect({
          message: `Select items to install ${pc.dim('(space to toggle)')}`,
          options: grouped,
          required: true,
        });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanup(tempDir);
          throw new CommandError(0);
        }

        const picks = selected as Array<{ name: string; type: string }>;

        // Map selections back to type-specific options
        const pickedSkills = picks.filter((p) => p.type === 'skill').map((p) => p.name);
        const pickedRules = picks.filter((p) => p.type === 'rule').map((p) => p.name);
        const pickedPrompts = picks.filter((p) => p.type === 'prompt').map((p) => p.name);
        const pickedAgents = picks.filter((p) => p.type === 'agent').map((p) => p.name);
        const pickedInstructions = picks.filter((p) => p.type === 'instruction').map((p) => p.name);

        if (pickedSkills.length > 0) options.skill = pickedSkills;
        if (pickedRules.length > 0) options.rule = pickedRules;
        if (pickedPrompts.length > 0) options.prompt = pickedPrompts;
        if (pickedAgents.length > 0) options.customAgent = pickedAgents;
        if (pickedInstructions.length > 0) options.instruction = pickedInstructions;

        // Re-run the type-specific handlers for any non-skill content
        if (pickedRules.length > 0) {
          await handleContextInstall('rule', source, skillsDir, options, spinner);
        }
        if (pickedPrompts.length > 0) {
          await handleContextInstall('prompt', source, skillsDir, options, spinner);
        }
        if (pickedAgents.length > 0) {
          await handleContextInstall('agent', source, skillsDir, options, spinner);
        }
        if (pickedInstructions.length > 0) {
          await handleContextInstall('instruction', source, skillsDir, options, spinner);
        }

        // If no skills were selected, we're done
        if (pickedSkills.length === 0) {
          await cleanup(tempDir);
          return;
        }

        // Fall through to skill installation with the selected skills
      } else {
        // No non-skill content, or non-interactive — proceed as before (skills only)
        spinner.stop(
          skills.length > 0
            ? `Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`
            : pc.red('No skills found')
        );

        if (skills.length === 0) {
          p.outro(
            pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
          );
          await cleanup(tempDir);
          throw new CommandError(1);
        }
      }
    }

    // When hasTypeFlags is true (user passed --skill, --rule, etc.), we need
    // to discover skills fresh. When !hasTypeFlags, unified discovery above
    // already handled non-skill content and set options.skill if skills were
    // picked. In either case, we need to discover skills here for the install flow.

    // Include internal skills when a specific skill is explicitly requested
    // (via --skill or @skill syntax), but NOT when using wildcard --skill '*'
    const includeInternal = !!(
      options.skill &&
      options.skill.length > 0 &&
      !options.skill.includes('*')
    );

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath, {
      includeInternal,
      fullDepth: options.fullDepth,
    });

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(
        pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
      );
      await cleanup(tempDir);
      throw new CommandError(1);
    }

    spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    let selectedSkills: Skill[];

    if (options.skill?.includes('*')) {
      // --skill '*' selects all skills
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);

      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        throw new CommandError(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      // Sort skills by plugin name first, then by skill name
      const sortedSkills = [...skills].sort((a, b) => {
        if (a.pluginName && !b.pluginName) return -1;
        if (!a.pluginName && b.pluginName) return 1;
        if (a.pluginName && b.pluginName && a.pluginName !== b.pluginName) {
          return a.pluginName.localeCompare(b.pluginName);
        }
        return getSkillDisplayName(a).localeCompare(getSkillDisplayName(b));
      });

      // Check if any skills have plugin grouping
      const hasGroups = sortedSkills.some((s) => s.pluginName);

      let selected: Skill[] | symbol;

      if (hasGroups) {
        // Build grouped options for groupMultiselect
        const grouped: Record<string, p.Option<Skill>[]> = {};
        for (const s of sortedSkills) {
          const groupName = s.pluginName ? kebabToTitle(s.pluginName) : 'Other';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName]!.push({
            value: s,
            label: getSkillDisplayName(s),
            hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
          });
        }

        selected = await p.groupMultiselect({
          message: `Select skills to install ${pc.dim('(space to toggle)')}`,
          options: grouped,
          required: true,
        });
      } else {
        const skillChoices = sortedSkills.map((s) => ({
          value: s,
          label: getSkillDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

        selected = await multiselect({
          message: 'Select skills to install',
          options: skillChoices,
          required: true,
        });
      }

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        throw new CommandError(0);
      }

      selectedSkills = selected as Skill[];
    }

    // Kick off security audit fetch early (non-blocking) so it runs
    // in parallel with agent selection, scope, and mode prompts.
    const ownerRepoForAudit = getOwnerRepo(parsed);
    const auditPromise = ownerRepoForAudit
      ? fetchAuditData(
          ownerRepoForAudit,
          selectedSkills.map((s) => getSkillDisplayName(s))
        )
      : Promise.resolve(null);

    // Resolve agents, scope, and install mode
    const targets = await resolveInstallTargets(options, spinner);

    if (!targets) {
      await cleanup(tempDir);
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
    const overwriteStatus = await checkOverwrites(selectedSkills, targetAgents, installGlobally);

    // Group selected skills for summary
    const groupedSummary: Record<string, Skill[]> = {};
    const ungroupedSummary: Skill[] = [];

    for (const skill of selectedSkills) {
      if (skill.pluginName) {
        const group = skill.pluginName;
        if (!groupedSummary[group]) groupedSummary[group] = [];
        groupedSummary[group].push(skill);
      } else {
        ungroupedSummary.push(skill);
      }
    }

    // Helper to print summary lines for a list of skills
    const printSkillSummary = (skills: Skill[]) => {
      for (const skill of skills) {
        if (summaryLines.length > 0) summaryLines.push('');

        const canonicalPath = getCanonicalPath(skill.name, { global: installGlobally });
        const shortCanonical = shortenPath(canonicalPath, cwd);
        summaryLines.push(`${pc.cyan(shortCanonical)}`);
        summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));

        const skillOverwrites = overwriteStatus.get(skill.name);
        const overwriteAgents = targetAgents
          .filter((a) => skillOverwrites?.get(a))
          .map((a) => agents[a].displayName);

        if (overwriteAgents.length > 0) {
          summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
        }
      }
    };

    // Build grouped summary
    const sortedGroups = Object.keys(groupedSummary).sort();

    for (const group of sortedGroups) {
      const title = kebabToTitle(group);

      summaryLines.push('');
      summaryLines.push(pc.bold(title));
      printSkillSummary(groupedSummary[group]!);
    }

    if (ungroupedSummary.length > 0) {
      if (sortedGroups.length > 0) {
        summaryLines.push('');
        summaryLines.push(pc.bold('General'));
      }
      printSkillSummary(ungroupedSummary);
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    // Await and display security audit results (started earlier in parallel)
    // Wrapped in try/catch so a failed audit fetch never blocks installation.
    try {
      const auditData = await auditPromise;
      if (auditData && ownerRepoForAudit) {
        const securityLines = buildSecurityLines(
          auditData,
          selectedSkills.map((s) => ({
            slug: getSkillDisplayName(s),
            displayName: getSkillDisplayName(s),
          })),
          ownerRepoForAudit
        );
        if (securityLines.length > 0) {
          p.note(securityLines.join('\n'), 'Security Risk Assessments');
        }
      }
    } catch {
      // Silently skip — security info is advisory only
    }

    if (!options.yes && !options.dryRun) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
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
        const result = await installSkillForAgent(skill, agent, {
          global: installGlobally,
          mode: installMode,
        });
        results.push({
          skill: getSkillDisplayName(skill),
          agent: agents[agent].displayName,
          pluginName: skill.pluginName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);

    // Track installation result
    // Build skillFiles map: { skillName: relative path to SKILL.md from repo root }
    const skillFiles: Record<string, string> = {};
    for (const skill of selectedSkills) {
      // skill.path is absolute, compute relative from tempDir (repo root)
      let relativePath: string;
      if (tempDir && skill.path === tempDir) {
        // Skill is at root level of repo
        relativePath = 'SKILL.md';
      } else if (tempDir && skill.path.startsWith(tempDir + sep)) {
        // Compute path relative to repo root (tempDir), not search path
        // Use forward slashes for telemetry (URL-style paths)
        relativePath =
          skill.path
            .slice(tempDir.length + 1)
            .split(sep)
            .join('/') + '/SKILL.md';
      } else {
        // Local path - skip telemetry for local installs
        continue;
      }
      skillFiles[skill.name] = relativePath;
    }

    // Normalize source to owner/repo format for telemetry
    const normalizedSource = getOwnerRepo(parsed);

    // Only track if we have a valid remote source and it's not a private repo
    if (normalizedSource) {
      const ownerRepo = parseOwnerRepo(normalizedSource);
      if (ownerRepo) {
        // Check if repo is private - skip telemetry for private repos
        const isPrivate = await isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
        // Only send telemetry if repo is public (isPrivate === false)
        // If we can't determine (null), err on the side of caution and skip telemetry
        if (isPrivate === false) {
          track({
            event: 'install',
            source: normalizedSource,
            skills: selectedSkills.map((s) => s.name).join(','),
            agents: targetAgents.join(','),
            ...(installGlobally && { global: '1' }),
            skillFiles: JSON.stringify(skillFiles),
          });
        }
      } else {
        // If we can't parse owner/repo, still send telemetry (for non-GitHub sources)
        track({
          event: 'install',
          source: normalizedSource,
          skills: selectedSkills.map((s) => s.name).join(','),
          agents: targetAgents.join(','),
          ...(installGlobally && { global: '1' }),
          skillFiles: JSON.stringify(skillFiles),
        });
      }
    }

    // Add to skill lock file for update tracking (only for global installs)
    if (successful.length > 0 && installGlobally && normalizedSource) {
      const successfulSkillNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            // Fetch the folder hash from GitHub Trees API
            let skillFolderHash = '';
            const skillPathValue = skillFiles[skill.name];
            if (parsed.type === 'github' && skillPathValue) {
              const hash = await fetchSkillFolderHash(
                normalizedSource,
                skillPathValue,
                undefined,
                parsed.ref
              );
              if (hash) skillFolderHash = hash;
            }

            await addSkillToLock(skill.name, {
              source: normalizedSource,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              skillPath: skillPathValue,
              ref: parsed.ref,
              skillFolderHash,
              pluginName: skill.pluginName,
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
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            const computedHash = await computeSkillFolderHash(skill.path);
            await addSkillToLocalLock(
              skill.name,
              {
                source: normalizedSource || parsed.url,
                sourceType: parsed.type,
                computedHash,
              },
              cwd
            );
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    displayInstallResults(results, targetAgents, cwd);

    console.log();
    p.outro(
      pc.green('Done!') +
        pc.dim('  Review skills before use; they run with full agent permissions.')
    );

    // Prompt for find-skills after successful install
    await promptForFindSkills(options, targetAgents);
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    if (error instanceof GitCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      // Print each line of the error message separately for better formatting
      for (const line of error.message.split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    showInstallTip();
    p.outro(pc.red('Installation failed'));
    throw new CommandError(1);
  } finally {
    await cleanup(tempDir);
  }
}

// Cleanup helper
async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Prompt user to install the find-skills skill after their first installation.
 */
async function promptForFindSkills(
  options?: AddOptions,
  targetAgents?: AgentType[]
): Promise<void> {
  // Skip if already dismissed or not in interactive mode
  if (!process.stdin.isTTY) return;
  if (options?.yes) return;

  try {
    const dismissed = await isPromptDismissed('findSkillsPrompt');
    if (dismissed) return;

    // Check if find-skills is already installed
    const findSkillsInstalled = await isSkillInstalled('find-skills', 'claude-code', {
      global: true,
    });
    if (findSkillsInstalled) {
      // Mark as dismissed so we don't check again
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    console.log();
    p.log.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-skills')} skill? It helps your agent discover and suggest skills.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    if (install) {
      // Install find-skills to the selected agents
      await dismissPrompt('findSkillsPrompt');

      const findSkillsAgents = targetAgents;

      // Skip if no valid agents remain
      if (!findSkillsAgents || findSkillsAgents.length === 0) {
        return;
      }

      console.log();
      p.log.step('Installing find-skills skill...');

      try {
        // Call runAdd directly
        await runAdd(['mfaux/dotai'], {
          skill: ['find-skills'],
          global: true,
          yes: true,
          targets: findSkillsAgents,
        });
      } catch {
        p.log.warn('Failed to install find-skills. You can try again with:');
        p.log.message(pc.dim('  npx dotai add mfaux/dotai@find-skills -g -y --all'));
      }
    } else {
      // User declined - dismiss the prompt
      await dismissPrompt('findSkillsPrompt');
      p.log.message(pc.dim('You can install it later with: npx dotai add mfaux/dotai@find-skills'));
    }
  } catch {
    // Don't fail the main installation if prompt fails
  }
}
