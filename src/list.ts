import type { AgentType, ContextType, LockEntry, TargetAgent } from './types.ts';
import { agents } from './agents.ts';
import { listInstalledSkills, type InstalledSkill } from './skill-installer.ts';
import { getAllLockedSkills } from './lib/lock/index.ts';
import { readDotaiLock, getLockEntriesByType, type DotaiLockFile } from './lib/lock/index.ts';
import { RESET, BOLD, DIM, CYAN, YELLOW, shortenPath, formatList, kebabToTitle } from './utils.ts';
import { consumeMultiValues, parseTypeFlag } from './cli-parse.ts';

interface ListOptions {
  global?: boolean;
  targets?: string[];
  type?: ContextType[];
}

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-a' || arg === '--targets') {
      options.targets = options.targets || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.targets.push(...values);
      i = nextIndex - 1;
    } else if (arg === '-t' || arg === '--type') {
      options.type = options.type || [];
      const { types, nextIndex } = parseTypeFlag(
        options.type,
        args,
        i + 1,
        (message: string): never => {
          console.log(`${YELLOW}${message}${RESET}`);
          process.exit(1);
        }
      );
      options.type = types;
      i = nextIndex - 1;
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

  // Determine which types to show
  const showSkills = !options.type || options.type.includes('skill');
  const showPrompts = !options.type || options.type.includes('prompt');
  const showAgents = !options.type || options.type.includes('agent');
  const showInstructions = !options.type || options.type.includes('instruction');

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.targets && options.targets.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.targets.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(`${YELLOW}Invalid targets: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid targets: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }

    agentFilter = options.targets as AgentType[];
  }

  // ── Fetch skills ──
  let installedSkills: InstalledSkill[] = [];
  let lockedSkills: Record<string, { pluginName?: string }> = {};
  if (showSkills) {
    installedSkills = await listInstalledSkills({
      global: scope,
      agentFilter,
    });
    lockedSkills = await getAllLockedSkills();
  }

  // ── Read dotai lock file once (used for prompts, agents, instructions) ──
  let dotaiLock: DotaiLockFile | null = null;
  if (showPrompts || showAgents || showInstructions) {
    try {
      const { lock } = await readDotaiLock(process.cwd());
      dotaiLock = lock;
    } catch {
      // Lock file doesn't exist or is corrupt — no prompts/agents to show
    }
  }

  const agentSet = agentFilter && agentFilter.length > 0 ? new Set<string>(agentFilter) : undefined;

  function filterAndSort(entries: LockEntry[]): LockEntry[] {
    let filtered = entries;
    if (agentSet) {
      filtered = filtered.filter((entry) => entry.agents.some((a) => agentSet.has(a)));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }

  // ── Fetch prompts (project-scoped only) ──
  let promptEntries: LockEntry[] = [];
  if (showPrompts && !scope && dotaiLock) {
    promptEntries = filterAndSort(getLockEntriesByType(dotaiLock, 'prompt'));
  }

  // ── Fetch agents (project-scoped only) ──
  let agentEntries: LockEntry[] = [];
  if (showAgents && !scope && dotaiLock) {
    agentEntries = filterAndSort(getLockEntriesByType(dotaiLock, 'agent'));
  }

  // ── Fetch instructions (project-scoped only) ──
  let instructionEntries: LockEntry[] = [];
  if (showInstructions && !scope && dotaiLock) {
    instructionEntries = filterAndSort(getLockEntriesByType(dotaiLock, 'instruction'));
  }

  const cwd = process.cwd();
  const scopeLabel = scope ? 'Global' : 'Project';
  const hasSkills = installedSkills.length > 0;
  const hasPrompts = promptEntries.length > 0;
  const hasAgents = agentEntries.length > 0;
  const hasInstructions = instructionEntries.length > 0;

  // ── Empty state ──
  if (!hasSkills && !hasPrompts && !hasAgents && !hasInstructions) {
    console.log(`${BOLD}${scopeLabel}${RESET}`);
    console.log();

    if (scope && (showPrompts || showAgents || showInstructions) && !showSkills) {
      // User asked for --type prompt/agent/instruction -g — explain they are project-scoped
      console.log(
        `${DIM}Prompts, agents, and instructions are project-scoped (use without -g to see them)${RESET}`
      );
      return;
    }
    if (!showSkills && showPrompts && !showAgents) {
      console.log(`${DIM}No project prompts found.${RESET}`);
      console.log(`${DIM}Add prompts with: npx dotai add <package> --prompt <name>${RESET}`);
      return;
    }
    if (!showSkills && !showPrompts && showAgents && !showInstructions) {
      console.log(`${DIM}No project agents found.${RESET}`);
      console.log(`${DIM}Add agents with: npx dotai add <package> --custom-agent <name>${RESET}`);
      return;
    }
    if (!showSkills && !showPrompts && !showAgents && showInstructions) {
      console.log(`${DIM}No project instructions found.${RESET}`);
      console.log(
        `${DIM}Add instructions with: npx dotai add <package> --instruction <name>${RESET}`
      );
      return;
    }
    if (showSkills && !showPrompts && !showAgents && !showInstructions) {
      console.log(`${DIM}No ${scopeLabel.toLowerCase()} skills found.${RESET}`);
      if (scope) {
        console.log(`${DIM}Try listing project skills without -g${RESET}`);
      } else {
        console.log(`${DIM}Try listing global skills with -g${RESET}`);
      }
      return;
    }
    // Default: show generic empty state
    console.log(`${DIM}No ${scopeLabel.toLowerCase()} context found.${RESET}`);
    console.log(`${DIM}Add skills with:       npx dotai add <package>${RESET}`);
    console.log(`${DIM}Add prompts with:      npx dotai add <package> --prompt <name>${RESET}`);
    console.log(
      `${DIM}Add agents with:       npx dotai add <package> --custom-agent <name>${RESET}`
    );
    console.log(
      `${DIM}Add instructions with: npx dotai add <package> --instruction <name>${RESET}`
    );
    return;
  }

  function printSkill(skill: InstalledSkill, indent: boolean = false): void {
    const prefix = indent ? '  ' : '';
    const shortPath = shortenPath(skill.canonicalPath, cwd);
    const agentNames = skill.agents.map((a) => agents[a].displayName);
    const agentInfo =
      skill.agents.length > 0 ? formatList(agentNames) : `${YELLOW}not linked${RESET}`;
    console.log(`${prefix}${CYAN}${skill.name}${RESET} ${DIM}${shortPath}${RESET}`);
    console.log(`${prefix}  ${DIM}Targets:${RESET} ${agentInfo}`);
  }

  function printRule(entry: LockEntry): void {
    const agentNames = entry.agents.map((a) => {
      const agentConfig = agents[a as AgentType];
      return agentConfig ? agentConfig.displayName : a;
    });
    const agentInfo = agentNames.length > 0 ? formatList(agentNames) : `${YELLOW}none${RESET}`;
    console.log(`${CYAN}${entry.name}${RESET} ${DIM}${entry.source}${RESET}`);
    console.log(`  ${DIM}Targets:${RESET} ${agentInfo}`);
  }

  // ── Skills section ──
  if (hasSkills && showSkills) {
    console.log(`${BOLD}${scopeLabel} Skills${RESET}`);
    console.log();

    // Group skills by plugin
    const groupedSkills: Record<string, InstalledSkill[]> = {};
    const ungroupedSkills: InstalledSkill[] = [];

    for (const skill of installedSkills) {
      const lockEntry = lockedSkills[skill.name];
      if (lockEntry?.pluginName) {
        const group = lockEntry.pluginName;
        if (!groupedSkills[group]) {
          groupedSkills[group] = [];
        }
        groupedSkills[group].push(skill);
      } else {
        ungroupedSkills.push(skill);
      }
    }

    const hasGroups = Object.keys(groupedSkills).length > 0;

    if (hasGroups) {
      // Print groups sorted alphabetically
      const sortedGroups = Object.keys(groupedSkills).sort();
      for (const group of sortedGroups) {
        // Convert kebab-case to Title Case for display header
        const title = kebabToTitle(group);

        console.log(`${BOLD}${title}${RESET}`);
        const skills = groupedSkills[group];
        if (skills) {
          for (const skill of skills) {
            printSkill(skill, true);
          }
        }
        console.log();
      }

      // Print ungrouped skills if any exist
      if (ungroupedSkills.length > 0) {
        console.log(`${BOLD}General${RESET}`);
        for (const skill of ungroupedSkills) {
          printSkill(skill, true);
        }
        console.log();
      }
    } else {
      // No groups, print flat list as before
      for (const skill of installedSkills) {
        printSkill(skill);
      }
      console.log();
    }
  }

  // ── Prompts section ──
  if (hasPrompts && showPrompts) {
    console.log(`${BOLD}Prompts${RESET}`);
    console.log();
    for (const entry of promptEntries) {
      printRule(entry); // Same display format works for prompts
    }
    console.log();
  }

  // ── Agents section ──
  if (hasAgents && showAgents) {
    console.log(`${BOLD}Agents${RESET}`);
    console.log();
    for (const entry of agentEntries) {
      printRule(entry); // Same display format works for agents
    }
    console.log();
  }

  // ── Instructions section ──
  if (hasInstructions && showInstructions) {
    console.log(`${BOLD}Instructions${RESET}`);
    console.log();
    for (const entry of instructionEntries) {
      printRule(entry); // Same display format works for instructions
    }
    console.log();
  }

  // ── Global mode note about prompts/agents/instructions ──
  if (
    scope &&
    (showPrompts || showAgents || showInstructions) &&
    !hasPrompts &&
    !hasAgents &&
    !hasInstructions
  ) {
    // Check if there are prompts, agents, or instructions in the project to mention
    if (dotaiLock) {
      const projectPrompts = getLockEntriesByType(dotaiLock, 'prompt');
      const projectAgents = getLockEntriesByType(dotaiLock, 'agent');
      const projectInstructions = getLockEntriesByType(dotaiLock, 'instruction');
      if (projectPrompts.length > 0 || projectAgents.length > 0 || projectInstructions.length > 0) {
        console.log(
          `${DIM}Prompts, agents, and instructions are project-scoped (use without -g to see them)${RESET}`
        );
        console.log();
      }
    }
  }
}
