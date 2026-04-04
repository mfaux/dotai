import * as readline from 'readline';
import * as p from '@clack/prompts';
import { runAdd } from './add.ts';
import { parseAddOptions } from './add-options.ts';
import { track } from './telemetry.ts';
import { isRepoPrivate, parseOwnerRepo } from './source-parser.ts';
import { fetchRepoTree } from './lib/git/index.ts';
import { discoverRemoteContext, type RemoteContextSummary } from './find-discovery.ts';
import { RESET, BOLD, DIM, TEXT, CYAN, MAGENTA, YELLOW } from './utils.ts';

// API endpoint for skills search
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';

export function formatInstalls(count: number): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
  return `${count} install${count === 1 ? '' : 's'}`;
}

export interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

// Search via API
export async function searchSkillsAPI(query: string): Promise<SearchSkill[]> {
  try {
    const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      skills: Array<{
        id: string;
        name: string;
        installs: number;
        source: string;
      }>;
    };

    return data.skills.map((skill) => ({
      name: skill.name,
      slug: skill.id,
      source: skill.source || '',
      installs: skill.installs,
    }));
  } catch {
    return [];
  }
}

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

// Custom fzf-style search prompt using raw readline
async function runSearchPrompt(initialQuery = ''): Promise<SearchSkill | null> {
  let results: SearchSkill[] = [];
  let selectedIndex = 0;
  let query = initialQuery;
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLines = 0;

  // Enable raw mode for keypress events
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Setup readline for keypress events but don't let it echo
  readline.emitKeypressEvents(process.stdin);

  // Resume stdin to start receiving events
  process.stdin.resume();

  // Hide cursor during selection
  process.stdout.write(HIDE_CURSOR);

  function render(): void {
    // Move cursor up to overwrite previous render
    if (lastRenderedLines > 0) {
      process.stdout.write(MOVE_UP(lastRenderedLines) + MOVE_TO_COL(1));
    }

    // Clear from cursor to end of screen (removes ghost trails)
    process.stdout.write(CLEAR_DOWN);

    const lines: string[] = [];

    // Search input line with cursor
    const cursor = `${BOLD}_${RESET}`;
    lines.push(`${TEXT}Search skills:${RESET} ${query}${cursor}`);
    lines.push('');

    // Results - keep showing existing results while loading new ones
    if (!query || query.length < 2) {
      lines.push(`${DIM}Start typing to search (min 2 chars)${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching...${RESET}`);
    } else if (results.length === 0) {
      lines.push(`${DIM}No context found${RESET}`);
    } else {
      const maxVisible = 8;
      const visible = results.slice(0, maxVisible);

      for (let i = 0; i < visible.length; i++) {
        const skill = visible[i]!;
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? `${BOLD}>${RESET}` : ' ';
        const name = isSelected ? `${BOLD}${skill.name}${RESET}` : `${TEXT}${skill.name}${RESET}`;
        const source = skill.source ? ` ${DIM}${skill.source}${RESET}` : '';
        const installs = formatInstalls(skill.installs);
        const installsBadge = installs ? ` ${CYAN}${installs}${RESET}` : '';
        const loadingIndicator = loading && i === 0 ? ` ${DIM}...${RESET}` : '';

        lines.push(`  ${arrow} ${name}${source}${installsBadge}${loadingIndicator}`);
      }
    }

    lines.push('');
    lines.push(`${DIM}up/down navigate | enter select | esc cancel${RESET}`);

    // Write each line
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    lastRenderedLines = lines.length;
  }

  function triggerSearch(q: string): void {
    // Always clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Always reset loading state when starting a new search
    loading = false;

    if (!q || q.length < 2) {
      results = [];
      selectedIndex = 0;
      render();
      return;
    }

    // Use API search for all queries (debounced)
    loading = true;
    render();

    // Adaptive debounce: shorter queries = longer wait (user still typing)
    // 2 chars: 250ms, 3 chars: 200ms, 4 chars: 150ms, 5+ chars: 150ms
    const debounceMs = Math.max(150, 350 - q.length * 50);

    debounceTimer = setTimeout(async () => {
      try {
        results = await searchSkillsAPI(q);
        selectedIndex = 0;
      } catch {
        results = [];
      } finally {
        loading = false;
        debounceTimer = null;
        render();
      }
    }, debounceMs);
  }

  // Trigger initial search if there's a query, then render
  if (initialQuery) {
    triggerSearch(initialQuery);
  }
  render();

  return new Promise((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(SHOW_CURSOR);
      // Pause stdin to fully release it for child processes
      process.stdin.pause();
    }

    function handleKeypress(_ch: string | undefined, key: readline.Key): void {
      if (!key) return;

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Cancel
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'return') {
        // Submit
        cleanup();
        resolve(results[selectedIndex] || null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, results.length - 1), selectedIndex + 1);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          triggerSearch(query);
        }
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        const char = key.sequence;
        if (char >= ' ' && char <= '~') {
          query += char;
          triggerSearch(query);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

function formatContextLine(
  count: number,
  label: string,
  items: { name: string; native?: string }[]
): string {
  const names = items.map((i) => (i.native ? `${i.name} [${i.native}]` : i.name)).join(', ');
  return `  ${count} ${label}${count !== 1 ? 's' : ''}    ${DIM}${names}${RESET}`;
}

function formatPickLabel(item: { name: string; native?: string }, type: string): string {
  const nativeTag = item.native ? `:${item.native}` : '';
  return `${item.name} (${type}${nativeTag})`;
}

/**
 * Show a context summary and let the user choose what to install.
 * Returns true if something was installed, false if cancelled.
 */
async function promptContextSelection(
  pkg: string,
  skillName: string,
  summary: RemoteContextSummary
): Promise<boolean> {
  console.log();
  console.log(`${TEXT}Found in ${BOLD}${pkg}${RESET}:`);

  if (summary.skills.length > 0)
    console.log(formatContextLine(summary.skills.length, 'skill', summary.skills));
  if (summary.prompts.length > 0)
    console.log(formatContextLine(summary.prompts.length, 'prompt', summary.prompts));
  if (summary.agents.length > 0)
    console.log(formatContextLine(summary.agents.length, 'agent', summary.agents));
  if (summary.instructions.length > 0)
    console.log(
      formatContextLine(summary.instructions.length, 'instruction', summary.instructions)
    );

  console.log();

  const action = await p.select({
    message: 'What would you like to install?',
    options: [
      { value: 'selected', label: `Install selected skill only (${skillName})` },
      { value: 'all', label: 'Install all context from this repo' },
      { value: 'pick', label: 'Pick individual items...' },
      { value: 'cancel', label: 'Cancel' },
    ],
  });

  if (p.isCancel(action) || action === 'cancel') {
    return false;
  }

  if (action === 'selected') {
    console.log();
    console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}...`);
    console.log();
    const { source, options } = parseAddOptions([pkg, '--skill', skillName]);
    await runAdd(source, options);
    return true;
  }

  if (action === 'all') {
    console.log();
    console.log(`${TEXT}Installing all context from ${BOLD}${pkg}${RESET}...`);
    console.log();
    const { source, options } = parseAddOptions([pkg]);
    await runAdd(source, options);
    return true;
  }

  // "pick" — multi-select from all discovered items
  const allItems = [
    ...summary.skills.map((i) => ({ value: i, label: formatPickLabel(i, 'skill') })),
    ...summary.prompts.map((i) => ({ value: i, label: formatPickLabel(i, 'prompt') })),
    ...summary.agents.map((i) => ({ value: i, label: formatPickLabel(i, 'agent') })),
    ...summary.instructions.map((i) => ({
      value: i,
      label: formatPickLabel(i, 'instruction'),
    })),
  ];

  // Pre-select the skill the user originally chose
  const preSelected = allItems
    .filter((o) => o.value.type === 'skill' && o.value.name === skillName)
    .map((o) => o.value);

  const picked = await p.multiselect({
    message: 'Select items to install',
    options: allItems,
    initialValues: preSelected,
    required: true,
  });

  if (p.isCancel(picked)) {
    return false;
  }

  // Build flags for runAdd
  const addArgs: string[] = [pkg];
  const byType = {
    skill: [] as string[],
    prompt: [] as string[],
    agent: [] as string[],
    instruction: [] as string[],
  };
  for (const item of picked) {
    byType[item.type].push(item.name);
  }

  if (byType.skill.length > 0) {
    addArgs.push('--skill', ...byType.skill);
  }
  if (byType.prompt.length > 0) {
    addArgs.push('--prompt', ...byType.prompt);
  }
  if (byType.agent.length > 0) {
    addArgs.push('--custom-agent', ...byType.agent);
  }

  console.log();
  console.log(
    `${TEXT}Installing ${BOLD}${picked.length} item${picked.length !== 1 ? 's' : ''}${RESET} from ${DIM}${pkg}${RESET}...`
  );
  console.log();
  const { source, options } = parseAddOptions(addArgs);
  await runAdd(source, options);
  return true;
}

async function isRepoPublic(owner: string, repo: string): Promise<boolean> {
  const isPrivate = await isRepoPrivate(owner, repo);
  // Return true only if we know it's public (isPrivate === false)
  // Return false if private or unable to determine
  return isPrivate === false;
}

export async function runFind(args: string[]): Promise<void> {
  const query = args.join(' ');
  const isNonInteractive = !process.stdin.isTTY;
  const agentTip = `${DIM}Tip: if running in a coding agent, follow these steps:${RESET}
${DIM}  1) npx dotai find [query]${RESET}
${DIM}  2) npx dotai add <owner/repo@skill>${RESET}`;

  // Non-interactive mode: just print results and exit
  if (query) {
    // If query looks like owner/repo, try direct repo tree discovery first
    const ownerRepo = parseOwnerRepo(query);
    if (ownerRepo) {
      const tree = await fetchRepoTree(query);
      if (tree) {
        const repoName = ownerRepo.repo;
        const summary = discoverRemoteContext(tree, repoName);
        const allItems = [
          ...summary.skills,
          ...summary.prompts,
          ...summary.agents,
          ...summary.instructions,
        ];

        if (allItems.length > 0) {
          track({
            event: 'find',
            query,
            resultCount: String(allItems.length),
          });

          // Group by type for structured output
          const byType: Record<string, typeof allItems> = {};
          for (const item of allItems) {
            const key = item.type;
            if (!byType[key]) byType[key] = [];
            byType[key].push(item);
          }

          const typeOrder = ['skill', 'prompt', 'agent', 'instruction'] as const;
          const typeLabels: Record<string, string> = {
            skill: 'Skills',
            prompt: 'Prompts',
            agent: 'Agents',
            instruction: 'Instructions',
          };

          for (const type of typeOrder) {
            const items = byType[type];
            if (!items || items.length === 0) continue;

            console.log(`${BOLD}${typeLabels[type]} (${items.length})${RESET}`);
            for (const item of items) {
              const nativeTag = item.native ? ` ${DIM}[${item.native}]${RESET}` : '';
              console.log(`  ${CYAN}${item.name}${RESET}${nativeTag}`);
            }
            console.log();
          }

          console.log(`${DIM}Install with:${RESET} npx dotai add ${query}`);
          console.log(`${DIM}Or specific items:${RESET} npx dotai add ${query} --prompt <name>`);
          console.log();
          return;
        }
      }
    }

    const results = await searchSkillsAPI(query);

    // Track telemetry for non-interactive search
    track({
      event: 'find',
      query,
      resultCount: String(results.length),
    });

    if (results.length === 0) {
      console.log(`${DIM}No context found for "${query}"${RESET}`);
      return;
    }

    console.log(`${DIM}Install with${RESET} npx dotai add <owner/repo@skill>`);
    console.log();

    for (const skill of results.slice(0, 6)) {
      const pkg = skill.source || skill.slug;
      const installs = formatInstalls(skill.installs);
      console.log(
        `${TEXT}${pkg}@${skill.name}${RESET}${installs ? ` ${CYAN}${installs}${RESET}` : ''}`
      );
      console.log(`${DIM}└ https://skills.sh/${skill.slug}${RESET}`);
      console.log();
    }
    return;
  }

  // Interactive mode - show tip only if running non-interactively (likely in a coding agent)
  if (isNonInteractive) {
    console.log(agentTip);
    console.log();
  }
  const selected = await runSearchPrompt();

  // Track telemetry for interactive search
  track({
    event: 'find',
    query: '',
    resultCount: selected ? '1' : '0',
    interactive: '1',
  });

  if (!selected) {
    console.log(`${DIM}Search cancelled${RESET}`);
    console.log();
    return;
  }

  // Use source (owner/repo) and skill name for installation
  const pkg = selected.source || selected.slug;
  const skillName = selected.name;

  // Try to discover other context types in the repo
  const tree = await fetchRepoTree(pkg);

  if (tree) {
    const repoName = pkg.includes('/') ? pkg.split('/')[1]! : pkg;
    const summary = discoverRemoteContext(tree, repoName);
    const totalOther =
      summary.prompts.length +
      summary.agents.length +
      summary.instructions.length +
      summary.skills.filter((s) => s.name !== skillName).length;

    if (totalOther > 0) {
      const installed = await promptContextSelection(pkg, skillName, summary);
      if (!installed) {
        console.log(`${DIM}Installation cancelled${RESET}`);
        console.log();
        return;
      }
      // promptContextSelection handles the install and trailing output
      return;
    }
  } else {
    console.log(`${DIM}(could not fetch repo tree — installing selected skill only)${RESET}`);
  }

  console.log();
  console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}...`);
  console.log();

  // Run add directly since we're in the same CLI
  const { source, options } = parseAddOptions([pkg, '--skill', skillName]);
  await runAdd(source, options);

  console.log();

  const info = parseOwnerRepo(pkg.includes('@') ? pkg.slice(0, pkg.lastIndexOf('@')) : pkg);
  if (info && (await isRepoPublic(info.owner, info.repo))) {
    console.log(
      `${DIM}View the skill at${RESET} ${TEXT}https://skills.sh/${selected.slug}${RESET}`
    );
  } else {
    console.log(`${DIM}Discover more skills at${RESET} ${TEXT}https://skills.sh${RESET}`);
  }

  console.log();
}
