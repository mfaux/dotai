#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runCheck, runUpdate } from './check.ts';
import { CommandError } from './command-result.ts';
import { runFind } from './find.ts';
import { runInit } from './init.ts';
import { runInstallFromLock } from './restore.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { RESET, BOLD, DIM, TEXT } from './utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const LOGO_LINES = [
  '██████╗  ██████╗ ████████╗ █████╗ ██╗',
  '██╔══██╗██╔═══██╗╚══██╔══╝██╔══██╗██║',
  '██║  ██║██║   ██║   ██║   ███████║██║',
  '██║  ██║██║   ██║   ██║   ██╔══██║██║',
  '██████╔╝╚██████╔╝   ██║   ██║  ██║██║',
  '╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}Universal context distribution for AI coding agents${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai add ${DIM}<package>${RESET}        ${DIM}Add context from a package${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai remove${RESET}               ${DIM}Remove installed context${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai list${RESET}                 ${DIM}List installed context${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai find ${DIM}[query]${RESET}         ${DIM}Search for skills${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai check${RESET}                ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai update${RESET}               ${DIM}Update installed items${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai restore${RESET}             ${DIM}Restore context from lock files${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai init ${DIM}[name]${RESET}          ${DIM}Create a context template${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx dotai experimental_sync${RESET}    ${DIM}Sync skills from node_modules${RESET}`
  );
  console.log();
  console.log(`${DIM}try:${RESET} npx dotai add vercel-labs/agent-skills`);
  console.log();
  console.log(`Discover skills at ${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai <command> [options]

${BOLD}Manage Context:${RESET}
  add <package>        Add context from a package (alias: a, install, i)
                       e.g. vercel-labs/agent-skills
                            https://github.com/vercel-labs/agent-skills
  remove [names]       Remove installed context
  list, ls             List installed context
  find [query]         Search for skills interactively

${BOLD}Updates:${RESET}
  check                Check for available updates (skills, rules, prompts, agents)
  update               Update installed items to latest versions

${BOLD}Project:${RESET}
  restore              Restore skills, rules, prompts, and agents from lock files
                       (alias: experimental_install)
  init [name]          Create a new context template (skill, rule, prompt, or agent)
                       Use 'init rule', 'init prompt', or 'init agent' for other types
  experimental_sync    Sync skills from node_modules into agent directories

${BOLD}Add Options:${RESET}
  -g, --global           Install globally (user-level) instead of project-level
  -a, --agent <agents>   Specify install agents (use '*' for all agents)
  -t, --type <types>     Filter by context type (skill, rule, prompt, agent; comma-separated)
  -s, --skill <skills>   Specify skill names to install (use '*' for all)
  -r, --rule <rules>     Specify rule names to install (repeatable)
  -p, --prompt <prompts> Specify prompt names to install (repeatable)
  --custom-agent <names> Specify agent names to install (AGENT.md context)
  --targets <agents>     Target rule/prompt/agent transpilation agents (comma-separated)
  --dry-run              Preview writes without making changes
  --force                Overwrite conflicting managed/unmanaged outputs
  --append               Append rules to AGENTS.md/CLAUDE.md instead of per-rule files
  --gitignore            Add transpiled output paths to .gitignore
  -l, --list             List available skills in the repository without installing
  -y, --yes              Skip confirmation prompts
  --copy                 Copy files instead of symlinking to agent directories
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify skills to remove (use '*' for all skills)
  -t, --type <types>     Filter by context type (skill, rule, prompt, agent; comma-separated)
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  
${BOLD}Experimental Sync Options:${RESET}
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -y, --yes              Skip confirmation prompts

${BOLD}List Options:${RESET}
  -g, --global           List global context (default: project)
  -a, --agent <agents>   Filter by specific agents
  -t, --type <types>     Filter by context type (skill, rule, prompt, agent)

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai add vercel-labs/agent-skills
  ${DIM}$${RESET} dotai add vercel-labs/agent-skills -g
  ${DIM}$${RESET} dotai add owner/repo --rule code-style --targets copilot,claude,cursor
  ${DIM}$${RESET} dotai add owner/repo --prompt review-code
  ${DIM}$${RESET} dotai add owner/repo --prompt review-code --rule code-style
  ${DIM}$${RESET} dotai add owner/repo --custom-agent architect
  ${DIM}$${RESET} dotai add owner/repo --custom-agent architect --targets copilot,claude
  ${DIM}$${RESET} dotai add owner/repo --rule code-style --gitignore
  ${DIM}$${RESET} dotai add owner/repo --type rule              ${DIM}# discover and install all rules${RESET}
  ${DIM}$${RESET} dotai add owner/repo --type rule,prompt       ${DIM}# install all rules and prompts${RESET}
  ${DIM}$${RESET} dotai add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} dotai remove                         ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} dotai remove web-design              ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} dotai remove --type rule code-style   ${DIM}# remove a rule${RESET}
  ${DIM}$${RESET} dotai remove --type prompt -y         ${DIM}# remove all prompts${RESET}
  ${DIM}$${RESET} dotai rm --global frontend-design
  ${DIM}$${RESET} dotai list                           ${DIM}# list project installs${RESET}
  ${DIM}$${RESET} dotai ls -g                          ${DIM}# list global installs${RESET}
  ${DIM}$${RESET} dotai ls -a claude-code              ${DIM}# filter by agent${RESET}
  ${DIM}$${RESET} dotai ls -t rule                     ${DIM}# list only rules${RESET}
  ${DIM}$${RESET} dotai ls -t prompt                   ${DIM}# list only prompts${RESET}
  ${DIM}$${RESET} dotai ls -t agent                    ${DIM}# list only agents${RESET}
  ${DIM}$${RESET} dotai find                           ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} dotai find typescript                ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} dotai check
  ${DIM}$${RESET} dotai update
  ${DIM}$${RESET} dotai restore                       ${DIM}# restore from lock files${RESET}
  ${DIM}$${RESET} dotai init my-skill
  ${DIM}$${RESET} dotai init prompt review-code         ${DIM}# create PROMPT.md template${RESET}
  ${DIM}$${RESET} dotai init agent architect             ${DIM}# create AGENT.md template${RESET}
  ${DIM}$${RESET} dotai experimental_sync              ${DIM}# sync from node_modules${RESET}
  ${DIM}$${RESET} dotai experimental_sync -y           ${DIM}# sync without prompts${RESET}

Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai remove [names...] [options]

${BOLD}Description:${RESET}
  Remove installed context (skills, rules, prompts, or agents).
  If no names are provided, an interactive selection menu will be shown.
  Use --type to target specific context types.

${BOLD}Arguments:${RESET}
  names             Optional context names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --agent        Remove from specific agents (use '*' for all agents)
  -s, --skill        Specify skills to remove (use '*' for all skills)
  -t, --type         Filter by context type (skill, rule, prompt, agent; comma-separated)
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --agent '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai remove                           ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} dotai remove my-skill                  ${DIM}# remove specific skill${RESET}
  ${DIM}$${RESET} dotai remove skill1 skill2 -y          ${DIM}# remove multiple, skip confirm${RESET}
  ${DIM}$${RESET} dotai remove --global my-skill         ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} dotai rm --agent claude-code my-skill  ${DIM}# remove from specific agent${RESET}
  ${DIM}$${RESET} dotai remove --type rule code-style    ${DIM}# remove a specific rule${RESET}
  ${DIM}$${RESET} dotai remove --type prompt -y          ${DIM}# remove all prompts${RESET}
  ${DIM}$${RESET} dotai remove --type rule,prompt        ${DIM}# interactive rule/prompt removal${RESET}
  ${DIM}$${RESET} dotai remove --all                     ${DIM}# remove all skills${RESET}

Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'a':
    case 'i':
    case 'install':
    case 'add': {
      showLogo();
      const { source: addSource, options: addOpts } = parseAddOptions(restArgs);
      await runAdd(addSource, addOpts);
      break;
    }
    case 'restore':
    case 'experimental_install': {
      showLogo();
      await runInstallFromLock(restArgs);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'experimental_sync': {
      showLogo();
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, syncOptions);
      break;
    }
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
      await runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      await runUpdate();
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}dotai --help${RESET} for usage.`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommandError) {
    if (error.message) {
      console.log(error.message);
    }
    process.exit(error.exitCode);
  }
  // Unexpected errors — print and exit with code 1
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
