# CLI Reference

Full option tables, examples, and authoring format for `dotai`. For a quick overview, see the [README](../README.md).

## add command options

| Option                      | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `-g, --global`              | Install to user directory instead of project                                 |
| `-t, --type <types...>`     | Filter by context type (`skill`, `rule`, `prompt`, `agent`; comma-separated) |
| `-s, --skill <skills...>`   | Install specific skills by name (repeatable; supports `'*'`)                 |
| `-r, --rule <rules...>`     | Install specific canonical rules by name (repeatable)                        |
| `-p, --prompt <prompts...>` | Install specific canonical prompts by name (repeatable)                      |
| `--custom-agent <names...>` | Install specific canonical custom agents by name (repeatable)                |
| `-a, --agents <agents...>`  | Target agents (comma-separated; use `'*'` for all)                           |
| `--copy`                    | Copy files instead of symlinking skills                                      |
| `--dry-run`                 | Preview writes without making changes                                        |
| `--force`                   | Overwrite conflicting managed/unmanaged outputs                              |
| `--append`                  | Append rules to `AGENTS.md`/`CLAUDE.md` instead of per-rule files            |
| `--gitignore`               | Add transpiled output paths to `.gitignore` (managed section)                |
| `--full-depth`              | Search all subdirectories even when a root `SKILL.md` exists                 |
| `-y, --yes`                 | Skip confirmation prompts                                                    |
| `--all`                     | Shorthand for `--skill '*' --agents '*' -y`                                  |

> **`--agents`:** A single flag for both skill install targets and transpilation targets. For skills, any of the 41 supported agents (e.g., `--agents cursor,claude-code`). For rules, prompts, and agents, the 6 transpilation targets: copilot, claude, cursor, windsurf, cline, opencode. When omitted, all detected agents are used for skills and all 6 transpilation targets for rules/prompts/agents.

> **Zero-flag mode:** Running `dotai add owner/repo` with no type-specific flags discovers all content types (skills, rules, prompts, agents) and presents an interactive grouped selection. Use `dotai find owner/repo` for a non-interactive preview.

> **`--append`:** Instead of writing individual rule files (e.g., `.github/instructions/code-style.instructions.md`), rules are appended as marker-delimited sections into `AGENTS.md` (Copilot) and `CLAUDE.md` (Claude Code). Useful for projects that prefer a single monolithic instruction file. Only applies to Copilot and Claude Code targets; other agents always get individual files.

> **`--gitignore`:** Adds transpiled output file paths to a managed `# dotai:start` / `# dotai:end` section in `.gitignore`. Use when transpiled outputs should not be committed — only the canonical source files and `.dotai-lock.json` are checked in, and teammates run `dotai add` to regenerate outputs locally.

<!-- agent-names:start -->

Supported agent aliases include values such as `claude-code` and `codex`. See [Supported Agents](supported-agents.md).

<!-- agent-names:end -->

## remove command options

| Option                     | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `-g, --global`             | Remove from global scope                                                     |
| `-a, --agents <agents...>` | Remove from specific agents (use `'*'` for all agents)                       |
| `-t, --type <types...>`    | Filter by context type (`skill`, `rule`, `prompt`, `agent`; comma-separated) |
| `-y, --yes`                | Skip confirmation prompts                                                    |
| `--all`                    | Remove all installed items                                                   |

## find command

Search for context interactively and preview all context types available in a repo before installing.

```bash
npx dotai find              # open interactive search prompt
npx dotai find react        # search non-interactively and list results
```

**Interactive mode** (no query argument) opens a fuzzy search prompt. After you select a result, dotai fetches the repo's file tree via the GitHub Trees API and shows a summary of all discovered context types:

```
Found in vercel-labs/agent-skills:
  2 skills    react-best-practices, nextjs-patterns
  3 rules     code-style, testing, imports
  1 prompt    review-code

? What would you like to install?
> Install selected skill only (react-best-practices)
  Install all context from this repo
  Pick individual items...
  Cancel
```

- **Install selected skill only** installs the single skill you picked from the search results.
- **Install all context from this repo** installs every skill, rule, prompt, and agent in the repo.
- **Pick individual items** opens a multi-select where you choose exactly which items to install.

If the GitHub Trees API is unreachable (rate limit, private repo, network error), the preview step is skipped and the selected skill is installed directly.

### Repo browsing

When you pass an `owner/repo` argument to `find`, dotai fetches the repo's file tree and displays a grouped summary:

```
Skills (2)
  react-best-practices
  nextjs-patterns

Rules (3)
  code-style
  testing
  imports [cursor]

Prompts (1)
  review-code

Install with: npx dotai add owner/repo
Or specific items: npx dotai add owner/repo --rule <name>
```

### Native context discovery

When scanning a repo via `dotai find owner/repo`, dotai also discovers agent-native context files in their conventional directories. These are files written for a specific coding agent (Cursor, Claude Code, Copilot, etc.) that can be installed as passthrough copies. Native items are tagged with their source agent in brackets (e.g., `[cursor]`).

The following native directories are scanned (derived from the [target-agents registry](#canonical-vs-native-files)):

| Agent          | Rules                                    | Prompts                       | Agents                      |
| -------------- | ---------------------------------------- | ----------------------------- | --------------------------- |
| Cursor         | `.cursor/rules/*.mdc`                    | —                             | —                           |
| Claude Code    | `.claude/rules/*.md`                     | `.claude/commands/*.md`       | `.claude/agents/*.md`       |
| GitHub Copilot | `.github/instructions/*.instructions.md` | `.github/prompts/*.prompt.md` | `.github/agents/*.agent.md` |
| OpenCode       | `.opencode/rules/*.md`                   | `.opencode/commands/*.md`     | `.opencode/agents/*.md`     |
| Windsurf       | `.windsurf/rules/*.md`                   | `.windsurf/workflows/*.md`    | —                           |
| Cline          | `.clinerules/*.md`                       | —                             | —                           |

**Non-interactive mode** (with a query argument) prints matching results with install commands, suitable for use inside AI coding agents.

## `import`

Convert native agent-specific rule files into canonical `RULES.md` format.

    npx dotai import
    npx dotai import --from cursor,claude-code
    npx dotai import --output rules/ --dry-run

| Flag              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `--from <agents>` | Comma-separated list of agents to import from (default: all detected) |
| `--output <dir>`  | Output directory for canonical rules (default: `rules/`)              |
| `--force`         | Overwrite existing canonical rules with the same name                 |
| `--dry-run`       | Preview imports without writing files                                 |

> **Note:** Some agent formats lose information during import. For example, Cursor's
> `alwaysApply: false` maps to `activation: auto` (could also mean `manual`), and
> Copilot rules have no description field. Review imported rules and adjust as needed.

### Supported native formats

| Agent          | Source directory                         | Parsed fields                     |
| -------------- | ---------------------------------------- | --------------------------------- |
| Cursor         | `.cursor/rules/*.mdc`                    | description, alwaysApply, globs   |
| Claude Code    | `.claude/rules/*.md`                     | description, globs                |
| GitHub Copilot | `.github/instructions/*.instructions.md` | applyTo                           |
| Windsurf       | `.windsurf/rules/*.md`                   | trigger, description, globs       |
| Cline          | `.clinerules/*.md`                       | heading, blockquote, "Applies to" |

## list command options

| Option                     | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `-g, --global`             | List global context (default: project)                                       |
| `-a, --agents <agents...>` | Filter by specific agents                                                    |
| `-t, --type <types...>`    | Filter by context type (`skill`, `rule`, `prompt`, `agent`; comma-separated) |

## Installation Scope

| Scope   | Flag      | Typical location                                 | Use case               |
| ------- | --------- | ------------------------------------------------ | ---------------------- |
| Project | (default) | `./<agent>/skills/` and transpiled local outputs | Shared with repository |
| Global  | `-g`      | `~/<agent>/skills/` and global targets           | Reuse across projects  |

## Examples

```bash
# Browse available context in a source repository
npx dotai find owner/repo

# Interactive install — discovers all content types
npx dotai add owner/repo

# Install one rule and one skill in a single run
npx dotai add owner/repo --rule code-style --skill db-migrate

# Install only prompts
npx dotai add owner/repo --prompt review-code

# Discover and install all rules from a source
npx dotai add owner/repo --type rule

# Install all rules and prompts from a source
npx dotai add owner/repo --type rule,prompt

# Install prompts and rules together
npx dotai add owner/repo --prompt review-code --rule code-style

# Install a custom agent
npx dotai add owner/repo --custom-agent architect

# Install agents targeting specific transpilation agents
npx dotai add owner/repo --custom-agent architect --agents copilot,claude

# Force replace an existing unmanaged target file
npx dotai add owner/repo --rule code-style --force

# Append rules to AGENTS.md and CLAUDE.md instead of per-rule files
npx dotai add owner/repo --rule code-style --append

# Keep transpiled outputs out of version control
npx dotai add owner/repo --rule code-style --gitignore

# CI-friendly non-interactive install
npx dotai add owner/repo --all --agents copilot,claude,cursor,windsurf,cline,opencode -y
```

## Team Sharing

Share a single command with teammates to install the same context:

```bash
# Share a rule for your team
npx dotai add owner/repo --rule code-style -y

# Share a prompt
npx dotai add owner/repo --prompt review-code -y

# Share all rules and prompts from a repo
npx dotai add owner/repo --type rule,prompt -y

# CI-friendly: install everything, skip prompts, target specific agents
npx dotai add owner/repo --all --agents copilot,claude,cursor -y
```

## How transpilation works

When you write a canonical file (`RULES.md`, `PROMPT.md`, `AGENT.md`), dotai splits it into two parts:

- **Frontmatter** (metadata like `activation`, `globs`, `model`, `tools`) is **mapped per-agent** into each target's native format.
- **Body** (everything after the frontmatter) is **passed verbatim** to all target agents. No content is filtered, adapted, or rewritten.

This means canonical bodies should contain **agent-agnostic instructions** — describe _what_ to do, not _how_ to do it with a specific agent's tools. For example, "run the tests before committing" is portable; "use the Bash tool to run tests" is Claude Code-specific and will land unchanged in Cursor, Windsurf, Copilot, and Cline where it won't make sense.

### Canonical vs native files

dotai also discovers **native agent-specific files** in source repos and passes them through byte-identical to only the matching agent:

| Agent          | Native rules                             | Native prompts                | Native agents               |
| -------------- | ---------------------------------------- | ----------------------------- | --------------------------- |
| Cursor         | `.cursor/rules/*.mdc`                    | —                             | —                           |
| GitHub Copilot | `.github/instructions/*.instructions.md` | `.github/prompts/*.prompt.md` | `.github/agents/*.agent.md` |
| Claude Code    | `.claude/rules/*.md`                     | `.claude/commands/*.md`       | `.claude/agents/*.md`       |
| OpenCode       | `.opencode/rules/*.md`                   | `.opencode/commands/*.md`     | `.opencode/agents/*.md`     |
| Windsurf       | `.windsurf/rules/*.md`                   | `.windsurf/workflows/*.md`    | —                           |
| Cline          | `.clinerules/*.md`                       | —                             | —                           |

A single source repo can contain both canonical and native files. Canonical files fan out to all target agents; native files go only to their matching agent.

| Use case                                        | Approach              |
| ----------------------------------------------- | --------------------- |
| Agent-agnostic coding standards                 | Canonical `RULES.md`  |
| Agent-specific tool references or workflows     | Native file           |
| Mix of portable and agent-specific instructions | Both in the same repo |

### Per-agent overrides

Canonical files can include **agent-namespaced override blocks** in their YAML frontmatter. When transpiling for a target agent, its override fields are shallow-merged on top of the base fields. Overrides for other agents are stripped.

This lets you keep a single canonical file while tuning specific fields per agent, without maintaining separate native files.

```markdown
---
name: code-style
description: Enforce TypeScript style conventions
globs:
  - '*.ts'
  - '*.tsx'
activation: auto

github-copilot:
  activation: always

claude-code:
  severity: error
---

Use `const` over `let` when the variable is never reassigned.
```

In this example, when transpiling for GitHub Copilot the effective `activation` is `always`. For Claude Code, `severity` is `error`. For Cursor, Windsurf, and Cline, the base fields are used unchanged.

Override blocks work on all three canonical types:

| Type        | Overridable fields                                                             |
| ----------- | ------------------------------------------------------------------------------ |
| `RULES.md`  | `description`, `globs`, `activation`, `severity`                               |
| `PROMPT.md` | `description`, `argument-hint`, `agent`, `model`, `tools`                      |
| `AGENT.md`  | `description`, `model`, `tools`, `disallowed-tools`, `max-turns`, `background` |

Identity fields (`name`, `schema-version`) and structural fields (`body`) cannot be overridden.

Override keys must match a valid target agent (`github-copilot`, `claude-code`, `cursor`, `windsurf`, `cline`, `opencode`). Unrecognized keys produce a parser warning.

Agent-exclusive fields like `disallowed-tools`, `max-turns`, and `background` can appear in any agent's override block. The transpiler for agents that do not support those fields ignores them, just as it does for base fields.

See [`examples/rule-with-overrides/RULES.md`](../examples/rule-with-overrides/RULES.md) for a complete working example.

## Source repo layout

dotai discovers context files by convention. It scans the source path (the repo or directory you pass to `dotai add`) for files in specific locations.

### Rules, prompts, and agents

Each type is discovered in two places:

| Type    | Root file   | Subdirectory pattern  |
| ------- | ----------- | --------------------- |
| Rules   | `RULES.md`  | `rules/*/RULES.md`    |
| Prompts | `PROMPT.md` | `prompts/*/PROMPT.md` |
| Agents  | `AGENT.md`  | `agents/*/AGENT.md`   |

If a root-level file and a subdirectory file share the same `name` (from frontmatter), the root-level file takes priority.

### Skills

Skills use a richer discovery strategy. dotai checks, in order:

1. **Direct path** — if the source path itself contains a `SKILL.md`, return it immediately.
2. **Priority directories** — `skills/*/`, `.agents/skills/*/`, `.claude/skills/*/`, `.github/skills/*/`, and ~20 more agent-specific skill directories.
3. **Plugin manifests** — paths declared in `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json`.
4. **Recursive fallback** — if no skills are found above (or `--full-depth` is set), walks the entire tree up to 5 levels deep, skipping `node_modules`, `.git`, `dist`, `build`, and `__pycache__`.

### Example directory tree

A source repo with multiple context types might look like this:

```
my-context-repo/
  RULES.md                    # single root-level rule
  rules/
    code-style/
      RULES.md                # additional rule
    error-handling/
      RULES.md                # additional rule
  prompts/
    review-code/
      PROMPT.md
  agents/
    architect/
      AGENT.md
  skills/
    db-migrate/
      SKILL.md
    testing/
      SKILL.md
  .cursor/rules/              # native passthrough (Cursor only)
    project-setup.mdc
  .claude/commands/            # native passthrough (Claude Code only)
    deploy.md
```

Every canonical file (`RULES.md`, `PROMPT.md`, `AGENT.md`, `SKILL.md`) must contain YAML frontmatter with at least `name` and `description`:

```markdown
---
name: code-style
description: Enforce TypeScript style conventions
---

Instructions go here.
```

### Native passthrough files

Agent-specific files placed in their conventional directories are discovered and copied byte-identical to the matching agent only. See the [native file table](#canonical-vs-native-files) for supported paths per agent.

## Canonical authoring format

Create reusable context once, then let `dotai` install/transpile to each target. See the [`examples/`](../examples) directory for complete, working examples of each type.

### Skill (`SKILL.md`)

```markdown
---
name: db-migrate
description: Run safe database migration workflows
---

Instructions for the AI agent go here.
```

### Rule (`RULES.md`)

```markdown
---
name: code-style
description: Enforce TypeScript style conventions
globs:
  - '*.ts'
  - '*.tsx'
activation: auto
---

Always use `const` over `let` when the variable is never reassigned.
```

Supported fields: `name` (required), `description` (required), `globs`, `activation` (`always` | `auto` | `manual` | `glob`), `severity`.

#### Activation mapping

The `activation` field controls how each target agent decides when to apply the rule:

| `activation` | Cursor              | Windsurf                  | Copilot            | Claude Code         | Cline                     | OpenCode       |
| ------------ | ------------------- | ------------------------- | ------------------ | ------------------- | ------------------------- | -------------- |
| `always`     | `alwaysApply: true` | `trigger: always_on`      | `applyTo: "**"`    | always applies      | always applies            | plain markdown |
| `auto`       | agent decides       | `trigger: model_decision` | `applyTo: "**"`    | agent decides       | always applies            | plain markdown |
| `manual`     | manual inclusion    | `trigger: manual`         | `applyTo: "**"`    | manual              | always applies            | plain markdown |
| `glob`       | `globs: <patterns>` | `trigger: glob`           | `applyTo: <globs>` | `globs: <patterns>` | `**Applies to:** <globs>` | plain markdown |

> **Note:** Cline uses plain markdown with no structured metadata, so all activation modes result in a rule that is always visible to the agent. Claude Code treats `globs` as independent file scoping — globs are emitted whenever present, regardless of activation mode. OpenCode rules are plain markdown with no frontmatter; users add the file path to the `instructions` array in `opencode.json` to activate them.

### Prompt (`PROMPT.md`)

```markdown
---
name: review-code
description: Review code for bugs and style issues
tools:
  - codebase_search
  - read_file
model: claude-sonnet-4
---

Review the following code for correctness, performance, and style.
```

Supported fields: `name` (required), `description` (required), `tools`, `model`, `agent`, `argument-hint`.

### Agent (`AGENT.md`)

```markdown
---
name: architect
description: Architecture-focused code reviewer
model: claude-sonnet-4
tools:
  - codebase_search
  - read_file
---

You are a senior software architect. Focus on system design, API boundaries, and maintainability.
```

Supported fields: `name` (required), `description` (required), `model`, `tools`, `disallowed-tools`, `max-turns`, `background`.

### Model Aliases

The `model` field in `PROMPT.md` and `AGENT.md` uses canonical model names (e.g., `claude-sonnet-4`) that are automatically resolved to agent-specific identifiers during transpilation. For example, `claude-haiku-3.5` maps to `claude-3.5-haiku` for Copilot and `claude-3-5-haiku-latest` for Claude Code.

If a model isn't supported by a target agent (e.g., `gpt-4o` on Claude Code), the `model` field is omitted from the output with a warning.

#### Custom Model Overrides

You can override model alias mappings in your project's `package.json`:

```json
{
  "dotai": {
    "modelAliases": {
      "claude-sonnet-4": {
        "github-copilot": "my-custom-sonnet-id"
      },
      "my-private-model": {
        "github-copilot": "private-copilot-id",
        "claude-code": "private-claude-id"
      }
    }
  }
}
```

User overrides take precedence over built-in mappings. Set a value to `null` to explicitly drop the model for a specific agent.

## Environment Variables

| Variable                             | Description                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `GITHUB_TOKEN` / `GH_TOKEN`          | GitHub API token for authenticated requests (private repos)        |
| `INSTALL_INTERNAL_SKILLS`            | Include skills marked `metadata.internal: true` (`1` or `true`)    |
| `CODEX_HOME`                         | Override Codex config directory (default: `~/.codex`)              |
| `CLAUDE_CONFIG_DIR`                  | Override Claude config directory (default: `~/.claude`)            |
| `SKILLS_API_URL`                     | Override skills search API base URL (default: `https://skills.sh`) |
| `DISABLE_TELEMETRY` / `DO_NOT_TRACK` | Disable anonymous usage telemetry                                  |
