import pc from 'picocolors';
import { discover, filterByType } from './rule-discovery.ts';
import { executeInstallPipeline } from './rule-installer.ts';
import {
  readDotaiLock,
  writeDotaiLock,
  upsertLockEntry,
  computeContentHash,
} from './dotai-lock.ts';
import { loadModelOverrides } from './model-aliases.ts';
import { TARGET_AGENTS } from './target-agents.ts';
import { addToGitignore } from './gitignore.ts';
import type { DiscoveredItem, LockEntry, TargetAgent } from './types.ts';

// ---------------------------------------------------------------------------
// Rule & prompt install — wires discovery → transpile → install pipeline
//
// This module handles the `dotai add owner/repo --rule <name>`,
// `dotai add owner/repo --prompt <name>`, and
// `dotai add owner/repo --agent <name>` flows.
// It uses the discovery engine and install pipeline,
// updating the dotai lock file on success.
//
// Skills are not handled here — they use the existing upstream installer.ts.
// ---------------------------------------------------------------------------

/**
 * Options for rule installation.
 */
export interface RuleAddOptions {
  /** Source identifier (e.g., "owner/repo") for lock file tracking. */
  source: string;
  /** Absolute path to the cloned/local source repo. */
  sourcePath: string;
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Rule names to install. Empty or ['*'] means all rules. */
  ruleNames: string[];
  /** Target agents to install for. Defaults to all five. */
  targets?: TargetAgent[];
  /** Preview planned writes without executing them. */
  dryRun?: boolean;
  /** Overwrite collisions instead of aborting. */
  force?: boolean;
  /** Use append mode for Copilot (AGENTS.md) and Claude Code (CLAUDE.md). */
  append?: boolean;
  /** Add transpiled output paths to .gitignore (opt-in). */
  gitignore?: boolean;
}

/**
 * Result of rule installation.
 */
export interface RuleAddResult {
  /** Whether the installation succeeded. */
  success: boolean;
  /** Number of rules installed. */
  rulesInstalled: number;
  /** Paths of files written. */
  writtenPaths: string[];
  /** Warning/info messages for CLI output. */
  messages: string[];
  /** Error message if installation failed. */
  error?: string;
}

/** Agent name aliases for --targets flag (short names to TargetAgent). */
const AGENT_ALIASES: Record<string, TargetAgent> = {
  copilot: 'github-copilot',
  'github-copilot': 'github-copilot',
  claude: 'claude-code',
  'claude-code': 'claude-code',
  cursor: 'cursor',
  opencode: 'opencode',
};

/**
 * Resolve agent name aliases to TargetAgent values.
 *
 * Accepts short names (e.g., "copilot", "claude") and full names
 * (e.g., "github-copilot", "claude-code").
 *
 * Returns null for unrecognized agent names.
 */
export function resolveTargetAgents(agentNames: string[]): {
  agents: TargetAgent[];
  invalid: string[];
} {
  const agents: TargetAgent[] = [];
  const invalid: string[] = [];

  for (const name of agentNames) {
    const normalized = name.toLowerCase().trim();
    const agent = AGENT_ALIASES[normalized];
    if (agent) {
      if (!agents.includes(agent)) {
        agents.push(agent);
      }
    } else {
      invalid.push(name);
    }
  }

  return { agents, invalid };
}

/**
 * Options for prompt installation.
 */
export interface PromptAddOptions {
  /** Source identifier (e.g., "owner/repo") for lock file tracking. */
  source: string;
  /** Absolute path to the cloned/local source repo. */
  sourcePath: string;
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Prompt names to install. Empty or ['*'] means all prompts. */
  promptNames: string[];
  /** Target agents to install for. Defaults to all five. */
  targets?: TargetAgent[];
  /** Preview planned writes without executing them. */
  dryRun?: boolean;
  /** Overwrite collisions instead of aborting. */
  force?: boolean;
  /** Add transpiled output paths to .gitignore (opt-in). */
  gitignore?: boolean;
}

/**
 * Result of prompt installation.
 */
export interface PromptAddResult {
  /** Whether the installation succeeded. */
  success: boolean;
  /** Number of prompts installed. */
  promptsInstalled: number;
  /** Paths of files written. */
  writtenPaths: string[];
  /** Warning/info messages for CLI output. */
  messages: string[];
  /** Error message if installation failed. */
  error?: string;
}

/**
 * Filter discovered items by name.
 *
 * - `['*']` or empty array returns all items.
 * - Otherwise, matches by exact name (case-insensitive).
 */
function filterItemsByName(items: DiscoveredItem[], names: string[]): DiscoveredItem[] {
  if (names.length === 0 || names.includes('*')) {
    return items;
  }

  const lowerNames = new Set(names.map((n) => n.toLowerCase()));
  return items.filter((item) => lowerNames.has(item.name.toLowerCase()));
}

/**
 * Execute the rule install flow:
 *
 * 1. Discover rules in source repo
 * 2. Filter by --rule names
 * 3. Run install pipeline (transpile, collision check, write)
 * 4. Update dotai lock file on success
 */
export async function addRules(options: RuleAddOptions): Promise<RuleAddResult> {
  const messages: string[] = [];

  // 1. Discover rules in source repo (skip other types for performance)
  const { items, warnings } = await discover(options.sourcePath, { types: ['rule'] });

  // Surface discovery warnings
  for (const warning of warnings) {
    messages.push(
      pc.yellow(`Warning: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`)
    );
  }

  // 2. Filter to rules only (items are already filtered, but filterByType is a safety net)
  const allRules = filterByType(items, 'rule');

  if (allRules.length === 0) {
    return {
      success: false,
      rulesInstalled: 0,
      writtenPaths: [],
      messages,
      error: 'No rules found in source repository.',
    };
  }

  // 3. Filter by requested rule names
  const selectedRules = filterItemsByName(allRules, options.ruleNames);

  if (selectedRules.length === 0) {
    const availableNames = allRules.map((r) => r.name).join(', ');
    return {
      success: false,
      rulesInstalled: 0,
      writtenPaths: [],
      messages,
      error: `No matching rules found for: ${options.ruleNames.join(', ')}. Available: ${availableNames}`,
    };
  }

  messages.push(`Found ${selectedRules.length} rule(s) to install`);

  // 4. Read existing lock file for collision detection
  const { lock } = await readDotaiLock(options.projectRoot);

  // 5. Run install pipeline
  const targets = options.targets ?? [...TARGET_AGENTS];
  const modelOverrides = await loadModelOverrides(options.projectRoot);
  const result = await executeInstallPipeline(selectedRules, {
    projectRoot: options.projectRoot,
    targets,
    source: options.source,
    lockEntries: lock.items,
    force: options.force,
    dryRun: options.dryRun,
    append: options.append,
    modelOverrides,
  });

  // Report collisions
  if (result.collisions.length > 0) {
    for (const collision of result.collisions) {
      messages.push(pc.red(`Conflict: ${collision.message}`));
    }
  }

  // Report skipped items
  for (const skip of result.skipped) {
    messages.push(pc.yellow(`Skipped: ${skip.item.name} — ${skip.reason}`));
  }

  if (!result.success) {
    return {
      success: false,
      rulesInstalled: 0,
      writtenPaths: result.written,
      messages,
      error: result.error,
    };
  }

  // Dry-run: report plan without writing lock
  if (options.dryRun) {
    for (const write of result.writes) {
      messages.push(pc.dim(`Would write: ${write.planned.absolutePath}`));
    }
    return {
      success: true,
      rulesInstalled: selectedRules.length,
      writtenPaths: [],
      messages,
    };
  }

  // 6. Update lock file on successful write
  if (result.written.length > 0) {
    let updatedLock = lock;
    const installedNames = new Set<string>();

    // Group written paths by rule name
    for (const write of result.writes) {
      installedNames.add(write.planned.name);
    }

    for (const ruleName of installedNames) {
      const ruleItem = selectedRules.find((r) => r.name === ruleName);
      if (!ruleItem) continue;

      const ruleWrites = result.writes.filter((w) => w.planned.name === ruleName);
      const ruleAgents = [...new Set(ruleWrites.map((w) => w.agent))];
      const outputPaths = ruleWrites.map((w) => w.planned.absolutePath);

      const entry: LockEntry = {
        type: 'rule',
        name: ruleName,
        source: options.source,
        format: ruleItem.format,
        agents: ruleAgents,
        hash: computeContentHash(ruleItem.rawContent),
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
        ...(options.append && { append: true }),
        ...(options.gitignore && { gitignored: true }),
      };

      updatedLock = upsertLockEntry(updatedLock, entry);
    }

    await writeDotaiLock(updatedLock, options.projectRoot);
    messages.push(`Updated ${pc.dim('.dotai-lock.json')}`);

    // Add output paths to .gitignore when --gitignore is used
    if (options.gitignore) {
      await addToGitignore(options.projectRoot, result.written);
      messages.push(`Updated ${pc.dim('.gitignore')} with output paths`);
    }
  }

  return {
    success: true,
    rulesInstalled: selectedRules.length,
    writtenPaths: result.written,
    messages,
  };
}

/**
 * Execute the prompt install flow:
 *
 * 1. Discover prompts in source repo
 * 2. Filter by --prompt names
 * 3. Run install pipeline (transpile, collision check, write)
 * 4. Update dotai lock file on success
 */
export async function addPrompts(options: PromptAddOptions): Promise<PromptAddResult> {
  const messages: string[] = [];

  // 1. Discover prompts in source repo (skip other types for performance)
  const { items, warnings } = await discover(options.sourcePath, { types: ['prompt'] });

  // Surface discovery warnings
  for (const warning of warnings) {
    messages.push(
      pc.yellow(`Warning: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`)
    );
  }

  // 2. Filter to prompts only (items are already filtered, but filterByType is a safety net)
  const allPrompts = filterByType(items, 'prompt');

  if (allPrompts.length === 0) {
    return {
      success: false,
      promptsInstalled: 0,
      writtenPaths: [],
      messages,
      error: 'No prompts found in source repository.',
    };
  }

  // 3. Filter by requested prompt names
  const selectedPrompts = filterItemsByName(allPrompts, options.promptNames);

  if (selectedPrompts.length === 0) {
    const availableNames = allPrompts.map((p) => p.name).join(', ');
    return {
      success: false,
      promptsInstalled: 0,
      writtenPaths: [],
      messages,
      error: `No matching prompts found for: ${options.promptNames.join(', ')}. Available: ${availableNames}`,
    };
  }

  messages.push(`Found ${selectedPrompts.length} prompt(s) to install`);

  // 4. Read existing lock file for collision detection
  const { lock } = await readDotaiLock(options.projectRoot);

  // 5. Run install pipeline
  const targets = options.targets ?? [...TARGET_AGENTS];
  const modelOverrides = await loadModelOverrides(options.projectRoot);
  const result = await executeInstallPipeline(selectedPrompts, {
    projectRoot: options.projectRoot,
    targets,
    source: options.source,
    lockEntries: lock.items,
    force: options.force,
    dryRun: options.dryRun,
    modelOverrides,
  });

  // Report collisions
  if (result.collisions.length > 0) {
    for (const collision of result.collisions) {
      messages.push(pc.red(`Conflict: ${collision.message}`));
    }
  }

  // Report skipped items
  for (const skip of result.skipped) {
    messages.push(pc.yellow(`Skipped: ${skip.item.name} — ${skip.reason}`));
  }

  if (!result.success) {
    return {
      success: false,
      promptsInstalled: 0,
      writtenPaths: result.written,
      messages,
      error: result.error,
    };
  }

  // Dry-run: report plan without writing lock
  if (options.dryRun) {
    for (const write of result.writes) {
      messages.push(pc.dim(`Would write: ${write.planned.absolutePath}`));
    }
    return {
      success: true,
      promptsInstalled: selectedPrompts.length,
      writtenPaths: [],
      messages,
    };
  }

  // 6. Update lock file on successful write
  if (result.written.length > 0) {
    let updatedLock = lock;
    const installedNames = new Set<string>();

    // Group written paths by prompt name
    for (const write of result.writes) {
      installedNames.add(write.planned.name);
    }

    for (const promptName of installedNames) {
      const promptItem = selectedPrompts.find((p) => p.name === promptName);
      if (!promptItem) continue;

      const promptWrites = result.writes.filter((w) => w.planned.name === promptName);
      const promptAgents = [...new Set(promptWrites.map((w) => w.agent))];
      const outputPaths = promptWrites.map((w) => w.planned.absolutePath);

      const entry: LockEntry = {
        type: 'prompt',
        name: promptName,
        source: options.source,
        format: promptItem.format,
        agents: promptAgents,
        hash: computeContentHash(promptItem.rawContent),
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
        ...(options.gitignore && { gitignored: true }),
      };

      updatedLock = upsertLockEntry(updatedLock, entry);
    }

    await writeDotaiLock(updatedLock, options.projectRoot);
    messages.push(`Updated ${pc.dim('.dotai-lock.json')}`);

    // Add output paths to .gitignore when --gitignore is used
    if (options.gitignore) {
      await addToGitignore(options.projectRoot, result.written);
      messages.push(`Updated ${pc.dim('.gitignore')} with output paths`);
    }
  }

  return {
    success: true,
    promptsInstalled: selectedPrompts.length,
    writtenPaths: result.written,
    messages,
  };
}

/**
 * Options for agent installation.
 */
export interface AgentAddOptions {
  /** Source identifier (e.g., "owner/repo") for lock file tracking. */
  source: string;
  /** Absolute path to the cloned/local source repo. */
  sourcePath: string;
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Agent names to install. Empty or ['*'] means all agents. */
  agentNames: string[];
  /** Target agents to install for. Defaults to all five. */
  targets?: TargetAgent[];
  /** Preview planned writes without executing them. */
  dryRun?: boolean;
  /** Overwrite collisions instead of aborting. */
  force?: boolean;
  /** Add transpiled output paths to .gitignore (opt-in). */
  gitignore?: boolean;
}

/**
 * Result of agent installation.
 */
export interface AgentAddResult {
  /** Whether the installation succeeded. */
  success: boolean;
  /** Number of agents installed. */
  agentsInstalled: number;
  /** Paths of files written. */
  writtenPaths: string[];
  /** Warning/info messages for CLI output. */
  messages: string[];
  /** Error message if installation failed. */
  error?: string;
}

/**
 * Execute the agent install flow:
 *
 * 1. Discover agents in source repo
 * 2. Filter by --agent names
 * 3. Run install pipeline (transpile, collision check, write)
 * 4. Update dotai lock file on success
 */
export async function addAgents(options: AgentAddOptions): Promise<AgentAddResult> {
  const messages: string[] = [];

  // 1. Discover agents in source repo (skip other types for performance)
  const { items, warnings } = await discover(options.sourcePath, { types: ['agent'] });

  // Surface discovery warnings
  for (const warning of warnings) {
    messages.push(
      pc.yellow(`Warning: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`)
    );
  }

  // 2. Filter to agents only (items are already filtered, but filterByType is a safety net)
  const allAgents = filterByType(items, 'agent');

  if (allAgents.length === 0) {
    return {
      success: false,
      agentsInstalled: 0,
      writtenPaths: [],
      messages,
      error: 'No agents found in source repository.',
    };
  }

  // 3. Filter by requested agent names
  const selectedAgents = filterItemsByName(allAgents, options.agentNames);

  if (selectedAgents.length === 0) {
    const availableNames = allAgents.map((a) => a.name).join(', ');
    return {
      success: false,
      agentsInstalled: 0,
      writtenPaths: [],
      messages,
      error: `No matching agents found for: ${options.agentNames.join(', ')}. Available: ${availableNames}`,
    };
  }

  messages.push(`Found ${selectedAgents.length} agent(s) to install`);

  // 4. Read existing lock file for collision detection
  const { lock } = await readDotaiLock(options.projectRoot);

  // 5. Run install pipeline
  const targets = options.targets ?? [...TARGET_AGENTS];
  const modelOverrides = await loadModelOverrides(options.projectRoot);
  const result = await executeInstallPipeline(selectedAgents, {
    projectRoot: options.projectRoot,
    targets,
    source: options.source,
    lockEntries: lock.items,
    force: options.force,
    dryRun: options.dryRun,
    modelOverrides,
  });

  // Report collisions
  if (result.collisions.length > 0) {
    for (const collision of result.collisions) {
      messages.push(pc.red(`Conflict: ${collision.message}`));
    }
  }

  // Report skipped items
  for (const skip of result.skipped) {
    messages.push(pc.yellow(`Skipped: ${skip.item.name} — ${skip.reason}`));
  }

  if (!result.success) {
    return {
      success: false,
      agentsInstalled: 0,
      writtenPaths: result.written,
      messages,
      error: result.error,
    };
  }

  // Dry-run: report plan without writing lock
  if (options.dryRun) {
    for (const write of result.writes) {
      messages.push(pc.dim(`Would write: ${write.planned.absolutePath}`));
    }
    return {
      success: true,
      agentsInstalled: selectedAgents.length,
      writtenPaths: [],
      messages,
    };
  }

  // 6. Update lock file on successful write
  if (result.written.length > 0) {
    let updatedLock = lock;
    const installedNames = new Set<string>();

    // Group written paths by agent name
    for (const write of result.writes) {
      installedNames.add(write.planned.name);
    }

    for (const agentName of installedNames) {
      const agentItem = selectedAgents.find((a) => a.name === agentName);
      if (!agentItem) continue;

      const agentWrites = result.writes.filter((w) => w.planned.name === agentName);
      const agentTargets = [...new Set(agentWrites.map((w) => w.agent))];
      const outputPaths = agentWrites.map((w) => w.planned.absolutePath);

      const entry: LockEntry = {
        type: 'agent',
        name: agentName,
        source: options.source,
        format: agentItem.format,
        agents: agentTargets,
        hash: computeContentHash(agentItem.rawContent),
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
        ...(options.gitignore && { gitignored: true }),
      };

      updatedLock = upsertLockEntry(updatedLock, entry);
    }

    await writeDotaiLock(updatedLock, options.projectRoot);
    messages.push(`Updated ${pc.dim('.dotai-lock.json')}`);

    // Add output paths to .gitignore when --gitignore is used
    if (options.gitignore) {
      await addToGitignore(options.projectRoot, result.written);
      messages.push(`Updated ${pc.dim('.gitignore')} with output paths`);
    }
  }

  return {
    success: true,
    agentsInstalled: selectedAgents.length,
    writtenPaths: result.written,
    messages,
  };
}

/**
 * Options for instruction installation.
 */
export interface InstructionAddOptions {
  /** Source identifier (e.g., "owner/repo") for lock file tracking. */
  source: string;
  /** Absolute path to the cloned/local source repo. */
  sourcePath: string;
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Instruction names to install. Empty or ['*'] means all instructions. */
  instructionNames: string[];
  /** Target agents to install for. Defaults to all five. */
  targets?: TargetAgent[];
  /** Preview planned writes without executing them. */
  dryRun?: boolean;
  /** Overwrite collisions instead of aborting. */
  force?: boolean;
  /** Add transpiled output paths to .gitignore (opt-in). */
  gitignore?: boolean;
}

/**
 * Result of instruction installation.
 */
export interface InstructionAddResult {
  /** Whether the installation succeeded. */
  success: boolean;
  /** Number of instructions installed. */
  instructionsInstalled: number;
  /** Paths of files written. */
  writtenPaths: string[];
  /** Warning/info messages for CLI output. */
  messages: string[];
  /** Error message if installation failed. */
  error?: string;
}

/**
 * Execute the instruction install flow:
 *
 * 1. Discover instructions in source repo
 * 2. Filter by --instruction names
 * 3. Run install pipeline (transpile, collision check, write)
 * 4. Update dotai lock file on success
 */
export async function addInstructions(
  options: InstructionAddOptions
): Promise<InstructionAddResult> {
  const messages: string[] = [];

  // 1. Discover instructions in source repo (skip other types for performance)
  const { items, warnings } = await discover(options.sourcePath, { types: ['instruction'] });

  // Surface discovery warnings
  for (const warning of warnings) {
    messages.push(
      pc.yellow(`Warning: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`)
    );
  }

  // 2. Filter to instructions only (items are already filtered, but filterByType is a safety net)
  const allInstructions = filterByType(items, 'instruction');

  if (allInstructions.length === 0) {
    return {
      success: false,
      instructionsInstalled: 0,
      writtenPaths: [],
      messages,
      error: 'No instructions found in source repository.',
    };
  }

  // 3. Filter by requested instruction names
  const selectedInstructions = filterItemsByName(allInstructions, options.instructionNames);

  if (selectedInstructions.length === 0) {
    const availableNames = allInstructions.map((i) => i.name).join(', ');
    return {
      success: false,
      instructionsInstalled: 0,
      writtenPaths: [],
      messages,
      error: `No matching instructions found for: ${options.instructionNames.join(', ')}. Available: ${availableNames}`,
    };
  }

  messages.push(`Found ${selectedInstructions.length} instruction(s) to install`);

  // 4. Read existing lock file for collision detection
  const { lock } = await readDotaiLock(options.projectRoot);

  // 5. Run install pipeline
  const targets = options.targets ?? [...TARGET_AGENTS];
  const result = await executeInstallPipeline(selectedInstructions, {
    projectRoot: options.projectRoot,
    targets,
    source: options.source,
    lockEntries: lock.items,
    force: options.force,
    dryRun: options.dryRun,
  });

  // Report collisions
  if (result.collisions.length > 0) {
    for (const collision of result.collisions) {
      messages.push(pc.red(`Conflict: ${collision.message}`));
    }
  }

  // Report skipped items
  for (const skip of result.skipped) {
    messages.push(pc.yellow(`Skipped: ${skip.item.name} — ${skip.reason}`));
  }

  if (!result.success) {
    return {
      success: false,
      instructionsInstalled: 0,
      writtenPaths: result.written,
      messages,
      error: result.error,
    };
  }

  // Dry-run: report plan without writing lock
  if (options.dryRun) {
    for (const write of result.writes) {
      messages.push(pc.dim(`Would write: ${write.planned.absolutePath}`));
    }
    return {
      success: true,
      instructionsInstalled: selectedInstructions.length,
      writtenPaths: [],
      messages,
    };
  }

  // 6. Update lock file on successful write
  if (result.written.length > 0) {
    let updatedLock = lock;
    const installedNames = new Set<string>();

    // Group written paths by instruction name
    for (const write of result.writes) {
      installedNames.add(write.planned.name);
    }

    for (const instrName of installedNames) {
      const instrItem = selectedInstructions.find((i) => i.name === instrName);
      if (!instrItem) continue;

      const instrWrites = result.writes.filter((w) => w.planned.name === instrName);
      const instrAgents = [...new Set(instrWrites.map((w) => w.agent))];
      const outputPaths = instrWrites.map((w) => w.planned.absolutePath);

      const entry: LockEntry = {
        type: 'instruction',
        name: instrName,
        source: options.source,
        format: instrItem.format,
        agents: instrAgents,
        hash: computeContentHash(instrItem.rawContent),
        installedAt: new Date().toISOString(),
        outputs: outputPaths,
        append: true,
        ...(options.gitignore && { gitignored: true }),
      };

      updatedLock = upsertLockEntry(updatedLock, entry);
    }

    await writeDotaiLock(updatedLock, options.projectRoot);
    messages.push(`Updated ${pc.dim('.dotai-lock.json')}`);

    // Add output paths to .gitignore when --gitignore is used
    if (options.gitignore) {
      await addToGitignore(options.projectRoot, result.written);
      messages.push(`Updated ${pc.dim('.gitignore')} with output paths`);
    }
  }

  return {
    success: true,
    instructionsInstalled: selectedInstructions.length,
    writtenPaths: result.written,
    messages,
  };
}
