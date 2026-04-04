#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add/index.ts';
import { runCheck, runUpdate } from './check.ts';
import { CommandError } from './lib/command-result.ts';
import { runFind } from './find.ts';
import { runInit } from './init.ts';
import { runInstallFromLock } from './restore.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { RESET, BOLD, DIM, TEXT, YELLOW } from './lib/utils.ts';

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
    `  ${DIM}$${RESET} ${TEXT}npx dotai find ${DIM}[query]${RESET}         ${DIM}Search for skills & context${RESET}`
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

${BOLD}Commands:${RESET}
  add <package>        Add context from a package
  remove [names]       Remove installed context
  list, ls             List installed context
  find [query]         Search for skills & context
  check                Check for available updates
  update               Update installed items
  restore              Restore from lock files
  init [name]          Create a context template

${BOLD}Options:${RESET}
  -h, --help           Show help (use with any command for details)
  -v, --version        Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai add owner/repo                          ${DIM}# interactive install (all types)${RESET}
  ${DIM}$${RESET} dotai add owner/repo --skill my-skill         ${DIM}# install a skill${RESET}
  ${DIM}$${RESET} dotai add owner/repo --type skill,prompt      ${DIM}# install all skills and prompts${RESET}
  ${DIM}$${RESET} dotai find owner/repo                         ${DIM}# browse available context${RESET}
  ${DIM}$${RESET} dotai remove                                  ${DIM}# interactive remove${RESET}

Run ${BOLD}dotai <command> --help${RESET} for command-specific options.
Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showAddHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai add <package> [options]

${BOLD}Description:${RESET}
  Add context (skills, prompts, agents, instructions) from a source repository.
  Sources can be GitHub shorthand, full URLs, or local paths.
  With no flags, presents an interactive selection of all discovered content.

${BOLD}Essentials:${RESET}
  <package>              GitHub shorthand (owner/repo), URL, or local path
  -a, --targets <targets>  Target agents (comma-separated; use '*' for all)
  -t, --type <types>       Filter by type (skill, prompt, agent, instruction; comma-separated)
  -g, --global             Install globally (user-level)
  -y, --yes                Skip confirmation prompts

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai add vercel-labs/agent-skills              ${DIM}# interactive (all types)${RESET}
  ${DIM}$${RESET} dotai add owner/repo --skill my-skill            ${DIM}# install a specific skill${RESET}
  ${DIM}$${RESET} dotai add owner/repo --targets copilot,claude   ${DIM}# target specific agents${RESET}
  ${DIM}$${RESET} dotai add owner/repo --type skill,prompt -y      ${DIM}# install all skills and prompts${RESET}

Run ${BOLD}dotai add --help-all${RESET} for all options.
Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showAddHelpAll(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai add <package> [options]

${BOLD}Description:${RESET}
  Add context (skills, prompts, agents, instructions) from a source repository.
  Sources can be GitHub shorthand, full URLs, or local paths.
  With no flags, presents an interactive selection of all discovered content.

${BOLD}Content Selection:${RESET}
  -s, --skill <skills>   Install specific skills (use '*' for all)
  -p, --prompt <prompts> Install specific prompts
  --custom-agent <names> Install specific agents (AGENT.md context)
  -t, --type <types>     Filter by type (skill, prompt, agent, instruction; comma-separated)

${BOLD}Target Options:${RESET}
  -a, --targets <targets>  Target agents (comma-separated; use '*' for all)
                           For skills: any of the ${DIM}41 supported agents${RESET}
                           For prompts/agents: copilot, claude, cursor, windsurf, cline

${BOLD}Install Options:${RESET}
  -g, --global           Install globally (user-level)
  --copy                 Copy files instead of symlinking
  --dry-run              Preview writes without making changes
  --force                Overwrite conflicting outputs
  --gitignore            Add transpiled output paths to .gitignore
  --full-depth           Search all subdirectories even when a root SKILL.md exists
  --all                  Shorthand for --skill '*' --targets '*' -y
  -y, --yes              Skip confirmation prompts

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai add vercel-labs/agent-skills              ${DIM}# interactive (all types)${RESET}
  ${DIM}$${RESET} dotai add owner/repo --skill my-skill            ${DIM}# install a specific skill${RESET}
  ${DIM}$${RESET} dotai add owner/repo --targets copilot,claude    ${DIM}# target specific agents${RESET}
  ${DIM}$${RESET} dotai add owner/repo --prompt review-code       ${DIM}# install a prompt${RESET}
  ${DIM}$${RESET} dotai add owner/repo --type skill,prompt -y     ${DIM}# install all skills and prompts${RESET}
  ${DIM}$${RESET} dotai add owner/repo --all -g                   ${DIM}# install everything globally${RESET}

Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showListHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai list [options]

${BOLD}Description:${RESET}
  List installed context (skills, prompts, agents, instructions).

${BOLD}Options:${RESET}
  -g, --global            List global context (default: project)
  -a, --targets <targets>   Filter by specific targets
  -t, --type <types>      Filter by type (skill, prompt, agent, instruction; comma-separated)

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai list                   ${DIM}# list project installs${RESET}
  ${DIM}$${RESET} dotai ls -g                  ${DIM}# list global installs${RESET}
  ${DIM}$${RESET} dotai ls -a claude-code      ${DIM}# filter by agent${RESET}
  ${DIM}$${RESET} dotai ls -t prompt           ${DIM}# list only prompts${RESET}

Discover skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} dotai remove [names...] [options]

${BOLD}Description:${RESET}
  Remove installed context (skills, prompts, agents, or instructions).
  If no names are provided, an interactive selection menu will be shown.
  Use --type to target specific context types.

${BOLD}Arguments:${RESET}
  names              Optional context names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --targets    Remove from specific targets (use '*' for all targets)
  -s, --skill        Specify skills to remove (use '*' for all skills)
  -t, --type         Filter by context type (skill, prompt, agent, instruction; comma-separated)
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --targets '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} dotai remove                            ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} dotai remove my-skill                   ${DIM}# remove specific skill${RESET}
  ${DIM}$${RESET} dotai remove skill1 skill2 -y           ${DIM}# remove multiple, skip confirm${RESET}
  ${DIM}$${RESET} dotai remove --global my-skill          ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} dotai rm --targets claude-code my-skill   ${DIM}# remove from specific target${RESET}
  ${DIM}$${RESET} dotai remove --type prompt review-code  ${DIM}# remove a specific prompt${RESET}
  ${DIM}$${RESET} dotai remove --type prompt -y           ${DIM}# remove all prompts${RESET}
  ${DIM}$${RESET} dotai remove --type skill,prompt        ${DIM}# interactive skill/prompt removal${RESET}
  ${DIM}$${RESET} dotai remove --all                      ${DIM}# remove all skills${RESET}

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
      if (restArgs.includes('--help-all')) {
        showAddHelpAll();
        break;
      }
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showAddHelp();
        break;
      }
      if (restArgs.includes('--rule') || restArgs.includes('-r')) {
        console.log(
          `${YELLOW}The --rule flag has been removed.${RESET} Use ${BOLD}--instruction${RESET} instead.\nSee ${TEXT}https://github.com/mfaux/dotai/issues/17${RESET} for details.`
        );
        process.exit(1);
      }
      if (restArgs.includes('--append')) {
        console.log(
          `${YELLOW}The --append flag has been removed.${RESET} Instructions now always use append mode.\nSee ${TEXT}https://github.com/mfaux/dotai/issues/17${RESET} for details.`
        );
        process.exit(1);
      }
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
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showListHelp();
        break;
      }
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

    case 'import':
      console.log(
        `${YELLOW}The import command has been removed.${RESET} Use ${BOLD}dotai add${RESET} with ${BOLD}--instruction${RESET} instead.\nSee ${TEXT}https://github.com/mfaux/dotai/issues/17${RESET} for details.`
      );
      process.exit(1);

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
