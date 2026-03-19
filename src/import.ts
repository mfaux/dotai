import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { targetAgents } from './target-agents.ts';
import { reverseTranspilers, serializeCanonicalRule } from './reverse-transpiler.ts';
import type { CanonicalRule, TargetAgent } from './types.ts';
import { RESET, DIM, TEXT, YELLOW } from './utils.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Project root directory (default: cwd). */
  projectRoot?: string;
  /** Output directory for canonical rules (default: 'rules/'). */
  outputDir?: string;
  /** Only import from these agents (default: all detected). */
  from?: TargetAgent[];
  /** Overwrite existing canonical rules. */
  force?: boolean;
  /** Preview only — don't write files. */
  dryRun?: boolean;
}

interface ImportedRule {
  rule: CanonicalRule;
  agent: TargetAgent;
  sourcePath: string;
}

interface ImportResult {
  imported: Array<{ name: string; outputPath: string; agent: TargetAgent }>;
  skipped: Array<{ name: string; outputPath: string; reason: string }>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * List files in a directory, returning empty array if it doesn't exist.
 */
function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Match a filename against a simple glob pattern (e.g. "*.md", "*.mdc").
 */
function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1));
  }
  return filename === pattern;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function discoverNativeRuleFiles(
  projectRoot: string,
  fromAgents?: TargetAgent[]
): Array<{ agent: TargetAgent; filePath: string; filename: string }> {
  const results: Array<{ agent: TargetAgent; filePath: string; filename: string }> = [];

  for (const [agentName, config] of Object.entries(targetAgents)) {
    const agent = agentName as TargetAgent;

    // Filter by --from flag
    if (fromAgents && !fromAgents.includes(agent)) {
      continue;
    }

    const { sourceDir, pattern } = config.nativeRuleDiscovery;
    const searchDir = join(projectRoot, sourceDir);

    const files = listFiles(searchDir);
    for (const file of files) {
      if (matchesPattern(file, pattern)) {
        results.push({
          agent,
          filePath: join(searchDir, file),
          filename: file,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main import pipeline
// ---------------------------------------------------------------------------

export function runImport(args: string[]): void {
  const options = parseImportOptions(args);

  if (args.includes('--help') || args.includes('-h')) {
    showImportHelp();
    return;
  }

  const result = executeImport(options);

  // Report results
  if (result.imported.length > 0) {
    const verb = options.dryRun ? 'Would import' : 'Imported';
    console.log(
      `${TEXT}${verb} ${result.imported.length} rule${result.imported.length === 1 ? '' : 's'} from native formats:${RESET}`
    );
    for (const item of result.imported) {
      console.log(`  ${item.outputPath}  ${DIM}(from ${item.agent})${RESET}`);
    }
  }

  if (result.skipped.length > 0) {
    if (result.imported.length > 0) console.log();
    console.log(
      `${DIM}Skipped ${result.skipped.length} rule${result.skipped.length === 1 ? '' : 's'}:${RESET}`
    );
    for (const item of result.skipped) {
      console.log(`  ${item.outputPath} ${DIM}${item.reason}${RESET}`);
    }
  }

  for (const warning of result.warnings) {
    console.log(`${YELLOW}warning:${RESET} ${warning}`);
  }

  if (result.imported.length === 0 && result.skipped.length === 0 && result.warnings.length === 0) {
    console.log(`${DIM}No native rule files found to import.${RESET}`);
  }
}

export function executeImport(options: ImportOptions = {}): ImportResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const outputDir = options.outputDir ?? 'rules';
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  const result: ImportResult = {
    imported: [],
    skipped: [],
    warnings: [],
  };

  // 1. Discover native rule files
  const nativeFiles = discoverNativeRuleFiles(projectRoot, options.from);

  // 2. Parse each file via matching reverse transpiler
  const parsedRules: ImportedRule[] = [];
  for (const { agent, filePath, filename } of nativeFiles) {
    const transpiler = reverseTranspilers[agent];
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      result.warnings.push(`failed to read ${filePath}`);
      continue;
    }

    const parseResult = transpiler.parse(content, filename);
    if (!parseResult.ok) {
      result.warnings.push(`${filePath}: ${parseResult.error}`);
      continue;
    }

    parsedRules.push({ rule: parseResult.rule, agent, sourcePath: filePath });
  }

  // 3. Deduplicate by name (first wins)
  const seenNames = new Map<string, TargetAgent>();
  const uniqueRules: ImportedRule[] = [];

  for (const item of parsedRules) {
    if (seenNames.has(item.rule.name)) {
      const existingAgent = seenNames.get(item.rule.name)!;
      result.warnings.push(
        `duplicate rule name "${item.rule.name}" from ${item.agent} (already seen from ${existingAgent})`
      );
      continue;
    }
    seenNames.set(item.rule.name, item.agent);
    uniqueRules.push(item);
  }

  // 4. Collision check + write
  for (const { rule, agent } of uniqueRules) {
    const ruleDir = join(projectRoot, outputDir, rule.name);
    const outputPath = join(ruleDir, 'RULES.md');
    const displayPath = `${outputDir}/${rule.name}/RULES.md`;

    if (existsSync(outputPath) && !force) {
      result.skipped.push({
        name: rule.name,
        outputPath: displayPath,
        reason: 'already exists (use --force to overwrite)',
      });
      continue;
    }

    if (!dryRun) {
      mkdirSync(ruleDir, { recursive: true });
      writeFileSync(outputPath, serializeCanonicalRule(rule));
    }

    result.imported.push({
      name: rule.name,
      outputPath: displayPath,
      agent,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI option parsing
// ---------------------------------------------------------------------------

export function parseImportOptions(args: string[]): ImportOptions {
  const options: ImportOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--from' && i + 1 < args.length) {
      const agentNames = args[++i]!.split(',').map((a) => a.trim());
      // Resolve common shorthands
      const resolved: TargetAgent[] = agentNames.map((a) => {
        if (a === 'copilot') return 'github-copilot';
        if (a === 'claude') return 'claude-code';
        return a as TargetAgent;
      });
      options.from = resolved;
    } else if (arg === '--output' && i + 1 < args.length) {
      options.outputDir = args[++i]!;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showImportHelp(): void {
  console.log(`
Usage: dotai import [options]

Convert native agent-specific rule files into canonical RULES.md format.
Discovers rules from agent directories in the current project and writes
them as canonical rules/ subdirectories.

Options:
  --from <agents>   Comma-separated list of agents to import from
                    (default: all detected). Aliases: copilot, claude
  --output <dir>    Output directory for canonical rules (default: rules/)
  --force           Overwrite existing canonical rules with the same name
  --dry-run         Preview imports without writing files
  -h, --help        Show this help message

Examples:
  dotai import
  dotai import --from cursor,claude-code
  dotai import --output rules/ --dry-run
  dotai import --force
`);
}
