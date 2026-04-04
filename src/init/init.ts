import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import { RESET, DIM, TEXT, BOLD, YELLOW } from '../lib/utils.ts';
import { KEBAB_CASE_PATTERN } from '../lib/validation.ts';

// ---------------------------------------------------------------------------
// Template configuration
// ---------------------------------------------------------------------------

interface TemplateConfig {
  /** The markdown filename (e.g. "INSTRUCTIONS.md") */
  file: string;
  /** Human-readable noun (e.g. "instruction") */
  noun: string;
  /** Generate the template content given the name */
  generateContent: (name: string) => string;
  /** Generate the "Next steps" lines (after the common first two) */
  extraNextSteps: string[];
  /**
   * Generate the install/publish section.
   * `displayPath` is the relative path to the created file.
   */
  installSection: (name: string, displayPath: string) => string;
}

const TEMPLATE_CONFIGS: Record<string, TemplateConfig> = {
  prompt: {
    file: 'PROMPT.md',
    noun: 'prompt',
    generateContent: (name: string) => `---
name: ${name}
description: Describe what this prompt does
argument-hint: <file-or-directory>
---

Your prompt instructions here.

Use $ARGUMENTS for additional input from the user.
`,
    extraNextSteps: [
      `  3. ${TEXT}$ARGUMENTS${RESET} and ${TEXT}tools${RESET} are mapped per-agent automatically`,
    ],
    installSection: (name: string) =>
      `${DIM}Installing:${RESET}\n  ${DIM}From repo:${RESET}  ${TEXT}npx dotai add <owner>/<repo> --prompt ${name}${RESET}`,
  },

  agent: {
    file: 'AGENT.md',
    noun: 'agent',
    generateContent: (name: string) => `---
name: ${name}
description: Describe what this agent does
---

You are a specialized agent for ${name}.

Provide instructions for the agent here.
`,
    extraNextSteps: [
      `  3. Keep body content agent-agnostic ${DIM}(it is passed verbatim to all target agents)${RESET}`,
    ],
    installSection: (name: string) =>
      `${DIM}Installing:${RESET}\n  ${DIM}From repo:${RESET}  ${TEXT}npx dotai add <owner>/<repo> --custom-agent ${name}${RESET}`,
  },

  instruction: {
    file: 'INSTRUCTIONS.md',
    noun: 'instruction',
    generateContent: (name: string) => `---
name: ${name}
description: Describe what this instruction does
---

Your instruction content here.
`,
    extraNextSteps: [
      `  3. Keep body content agent-agnostic ${DIM}(it is passed verbatim to all target agents)${RESET}`,
    ],
    installSection: (name: string) =>
      `${DIM}Installing:${RESET}\n  ${DIM}From repo:${RESET}  ${TEXT}npx dotai add <owner>/<repo> --instruction ${name}${RESET}`,
  },

  skill: {
    file: 'SKILL.md',
    noun: 'skill',
    generateContent: (name: string) => `---
name: ${name}
description: A brief description of what this skill does
---

# ${name}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`,
    extraNextSteps: [],
    installSection: (_name: string, displayPath: string) =>
      `${DIM}Publishing:${RESET}\n  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx dotai add <owner>/<repo>${RESET}\n  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx dotai add https://example.com/${displayPath}${RESET}\n\nBrowse existing skills for inspiration at ${TEXT}https://skills.sh/${RESET}`,
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a user-supplied init name. Must be kebab-case to prevent
 * path traversal (../, slashes) and ensure valid frontmatter names.
 */
function validateInitName(name: string, type: string): boolean {
  if (!KEBAB_CASE_PATTERN.test(name)) {
    console.log(`${TEXT}Invalid name: ${DIM}${name}${RESET}`);
    console.log(
      `${DIM}Names must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-${type}")${RESET}`
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Core init logic
// ---------------------------------------------------------------------------

function initTemplate(config: TemplateConfig, name: string, hasName: boolean, cwd: string): void {
  if (hasName && !validateInitName(name, config.noun)) {
    return;
  }

  const dir = hasName ? join(cwd, name) : cwd;
  const filePath = join(dir, config.file);
  const displayPath = hasName ? `${name}/${config.file}` : config.file;

  if (existsSync(filePath)) {
    // Capitalize the noun for display: "instruction" → "Instruction"
    const label = config.noun.charAt(0).toUpperCase() + config.noun.slice(1);
    console.log(`${TEXT}${label} already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, config.generateContent(name));

  console.log(`${TEXT}Initialized ${config.noun}: ${DIM}${name}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  1. Edit ${TEXT}${displayPath}${RESET} to define your ${config.noun} instructions`);
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  for (const step of config.extraNextSteps) {
    console.log(step);
  }
  console.log();
  console.log(config.installSection(name, displayPath));
  console.log();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runInit(args: string[]): void {
  const cwd = process.cwd();

  // Determine which template type to create
  const typeArg = args[0];

  // Rule template — removed, show deprecation error
  if (typeArg === 'rule' || typeArg === '--rule') {
    console.log(
      `${YELLOW}The rule template has been removed.${RESET} Use ${BOLD}dotai init instruction${RESET} instead.\nSee ${TEXT}https://github.com/mfaux/dotai/issues/17${RESET} for details.`
    );
    process.exit(1);
  }

  // Prompt template
  if (typeArg === 'prompt' || typeArg === '--prompt') {
    const config = TEMPLATE_CONFIGS['prompt']!;
    const name = args[1] || basename(cwd);
    const hasName = args[1] !== undefined;
    initTemplate(config, name, hasName, cwd);
    return;
  }

  // Agent template
  if (typeArg === 'agent' || typeArg === '--agent') {
    const config = TEMPLATE_CONFIGS['agent']!;
    const name = args[1] || basename(cwd);
    const hasName = args[1] !== undefined;
    initTemplate(config, name, hasName, cwd);
    return;
  }

  // Instruction template
  if (typeArg === 'instruction' || typeArg === '--instruction') {
    const config = TEMPLATE_CONFIGS['instruction']!;
    const name = args[1] || basename(cwd);
    const hasName = args[1] !== undefined;
    initTemplate(config, name, hasName, cwd);
    return;
  }

  // Default: skill template
  const config = TEMPLATE_CONFIGS['skill']!;
  const name = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;
  initTemplate(config, name, hasName, cwd);
}
