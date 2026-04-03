import type { ContextType } from './types.ts';
import type { GitHubTreeEntry } from './github-trees.ts';
import { targetAgents } from './target-agents.ts';

export interface RemoteContextItem {
  name: string;
  path: string;
  type: ContextType;
  /** When set, indicates a native agent-specific file (e.g. "cursor", "claude-code"). */
  native?: string;
}

export interface RemoteContextSummary {
  skills: RemoteContextItem[];
  prompts: RemoteContextItem[];
  agents: RemoteContextItem[];
  instructions: RemoteContextItem[];
}

/**
 * Canonical file patterns per context type.
 * Matches root-level and directory-scoped items (blobs only).
 */
const PATTERNS: Array<{ regex: RegExp; type: ContextType }> = [
  { regex: /^(?:skills\/([^/]+)\/)?SKILL\.md$/, type: 'skill' },
  { regex: /^(?:prompts\/([^/]+)\/)?PROMPT\.md$/, type: 'prompt' },
  { regex: /^(?:agents\/([^/]+)\/)?AGENT\.md$/, type: 'agent' },
  { regex: /^INSTRUCTIONS\.md$/, type: 'instruction' },
];

/**
 * Build native discovery matchers from the target-agents registry.
 * Each matcher maps a sourceDir + glob pattern to a context type and agent name.
 */
interface NativeMatcher {
  /** Directory prefix to match (with trailing slash). */
  dirPrefix: string;
  /** File extension to match (e.g. ".mdc", ".md", ".instructions.md"). */
  extension: string;
  type: ContextType;
  agentName: string;
  agentDisplayName: string;
}

function buildNativeMatchers(): NativeMatcher[] {
  const matchers: NativeMatcher[] = [];

  for (const config of Object.values(targetAgents)) {
    // Native prompts
    if (config.nativePromptDiscovery) {
      const promptExt = config.nativePromptDiscovery.pattern.replace('*', '');
      matchers.push({
        dirPrefix: config.nativePromptDiscovery.sourceDir + '/',
        extension: promptExt,
        type: 'prompt',
        agentName: config.name,
        agentDisplayName: config.displayName,
      });
    }

    // Native agents
    if (config.nativeAgentDiscovery) {
      const agentExt = config.nativeAgentDiscovery.pattern.replace('*', '');
      matchers.push({
        dirPrefix: config.nativeAgentDiscovery.sourceDir + '/',
        extension: agentExt,
        type: 'agent',
        agentName: config.name,
        agentDisplayName: config.displayName,
      });
    }
  }

  return matchers;
}

const NATIVE_MATCHERS = buildNativeMatchers();

/**
 * Derive a name from a native file path by stripping the directory prefix and extension.
 */
function deriveNativeName(path: string, dirPrefix: string, extension: string): string {
  const filename = path.slice(dirPrefix.length);
  if (filename.endsWith(extension)) {
    return filename.slice(0, -extension.length);
  }
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

/**
 * Scan a GitHub tree for canonical and native context items.
 */
export function discoverRemoteContext(
  tree: GitHubTreeEntry[],
  repoName?: string
): RemoteContextSummary {
  const summary: RemoteContextSummary = {
    skills: [],
    prompts: [],
    agents: [],
    instructions: [],
  };
  const fallbackName = repoName ?? 'root';

  for (const entry of tree) {
    if (entry.type !== 'blob') continue;

    // Try canonical patterns first
    let matched = false;
    for (const { regex, type } of PATTERNS) {
      const match = entry.path.match(regex);
      if (!match) continue;

      const name = match[1] ?? fallbackName;
      const key = `${type}s` as keyof RemoteContextSummary;
      summary[key].push({ name, path: entry.path, type });
      matched = true;
      break;
    }
    if (matched) continue;

    // Try native agent-specific patterns
    for (const matcher of NATIVE_MATCHERS) {
      if (
        entry.path.startsWith(matcher.dirPrefix) &&
        entry.path.endsWith(matcher.extension) &&
        !entry.path.includes('/', matcher.dirPrefix.length) // no subdirectories
      ) {
        const name = deriveNativeName(entry.path, matcher.dirPrefix, matcher.extension);
        if (!name) continue;
        const key = `${matcher.type}s` as keyof RemoteContextSummary;
        summary[key].push({
          name,
          path: entry.path,
          type: matcher.type,
          native: matcher.agentName,
        });
        break;
      }
    }
  }

  return summary;
}
