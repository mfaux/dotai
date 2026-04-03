# CLI Reference

Full option tables, examples, and authoring format for `dotai`. For a quick overview, see the [README](../README.md).

## add command options

| Option                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `-g, --global`               | Install to user directory instead of project                                        |
| `-t, --type <types...>`      | Filter by context type (`skill`, `prompt`, `agent`, `instruction`; comma-separated) |
| `-s, --skill <skills...>`    | Install specific skills by name (repeatable; supports `'*'`)                        |
| `-p, --prompt <prompts...>`  | Install specific canonical prompts by name (repeatable)                             |
| `--custom-agent <names...>`  | Install specific canonical custom agents by name (repeatable)                       |
| `-i, --instruction <names>`  | Install specific canonical instructions by name (repeatable)                        |
| `-a, --targets <targets...>` | Targets (comma-separated; use `'*'` for all)                                        |
| `--copy`                     | Copy files instead of symlinking skills                                             |
| `--dry-run`                  | Preview writes without making changes                                               |
| `--force`                    | Overwrite conflicting managed/unmanaged outputs                                     |
| `--gitignore`                | Add transpiled output paths to `.gitignore` (managed section)                       |
| `--full-depth`               | Search all subdirectories even when a root `SKILL.md` exists                        |
| `-y, --yes`                  | Skip confirmation prompts                                                           |
| `--all`                      | Shorthand for `--skill '*' --targets '*' -y`                                        |

> **`--targets`:** A single flag for both skill install targets and transpilation targets. For skills, any of the supported targets (e.g., `--targets cursor,claude-code`). For prompts, agents, and instructions, the transpilation targets: copilot, claude, cursor, opencode. When omitted, all detected targets are used for skills and all transpilation targets for prompts/agents/instructions.

> **Zero-flag mode:** Running `dotai add owner/repo` with no type-specific flags discovers all content types (skills, prompts, agents, instructions) and presents an interactive grouped selection. Use `dotai find owner/repo` for a non-interactive preview.

> **`--gitignore`:** Adds transpiled output file paths to a managed `# dotai:start` / `# dotai:end` section in `.gitignore`. Use when transpiled outputs should not be committed — only the canonical source files and `.dotai-lock.json` are checked in, and teammates run `dotai add` to regenerate outputs locally.

<!-- agent-names:start -->

Supported target aliases include values such as `claude-code` and `codex`. See [Supported Targets](supported-targets.md).

<!-- agent-names:end -->

## remove command options

| Option                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `-g, --global`               | Remove from global scope                                                            |
| `-a, --targets <targets...>` | Remove from specific targets (use `'*'` for all targets)                            |
| `-t, --type <types...>`      | Filter by context type (`skill`, `prompt`, `agent`, `instruction`; comma-separated) |
| `-y, --yes`                  | Skip confirmation prompts                                                           |
| `--all`                      | Remove all installed items                                                          |

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
  1 prompt    review-code
  1 instruction  project-setup

? What would you like to install?
> Install selected skill only (react-best-practices)
  Install all context from this repo
  Pick individual items...
  Cancel
```

- **Install selected skill only** installs the single skill you picked from the search results.
- **Install all context from this repo** installs every skill, prompt, agent, and instruction in the repo.
- **Pick individual items** opens a multi-select where you choose exactly which items to install.

If the GitHub Trees API is unreachable (rate limit, private repo, network error), the preview step is skipped and the selected skill is installed directly.

### Repo browsing

When you pass an `owner/repo` argument to `find`, dotai fetches the repo's file tree and displays a grouped summary:

```
Skills (2)
  react-best-practices
  nextjs-patterns

Prompts (1)
  review-code

Instructions (1)
  project-setup

Install with: npx dotai add owner/repo
Or specific items: npx dotai add owner/repo --instruction <name>
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

**Non-interactive mode** (with a query argument) prints matching results with install commands, suitable for use inside AI coding agents.

## list command options

| Option                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `-g, --global`               | List global context (default: project)                                              |
| `-a, --targets <targets...>` | Filter by specific targets                                                          |
| `-t, --type <types...>`      | Filter by context type (`skill`, `prompt`, `agent`, `instruction`; comma-separated) |

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

# Install an instruction and a skill in a single run
npx dotai add owner/repo --instruction project-setup --skill db-migrate

# Install only prompts
npx dotai add owner/repo --prompt review-code

# Discover and install all instructions from a source
npx dotai add owner/repo --type instruction

# Install all instructions and prompts from a source
npx dotai add owner/repo --type instruction,prompt

# Install a custom agent
npx dotai add owner/repo --custom-agent architect

# Install agents targeting specific transpilation targets
npx dotai add owner/repo --custom-agent architect --targets copilot,claude

# Force replace an existing unmanaged target file
npx dotai add owner/repo --prompt review-code --force

# Keep transpiled outputs out of version control
npx dotai add owner/repo --instruction project-setup --gitignore

# CI-friendly non-interactive install
npx dotai add owner/repo --all --targets copilot,claude,cursor,opencode -y
```

## Team Sharing

Share a single command with teammates to install the same context:

```bash
# Share an instruction for your team
npx dotai add owner/repo --instruction project-setup -y

# Share a prompt
npx dotai add owner/repo --prompt review-code -y

# Share all instructions and prompts from a repo
npx dotai add owner/repo --type instruction,prompt -y

# CI-friendly: install everything, skip prompts, limit to specific targets
npx dotai add owner/repo --all --targets copilot,claude,cursor -y
```

## How transpilation works

When you write a canonical file (`PROMPT.md`, `AGENT.md`, `INSTRUCTIONS.md`), dotai splits it into two parts:

- **Frontmatter** (metadata like `model`, `tools`, `description`) is **mapped per-agent** into each target's native format.
- **Body** (everything after the frontmatter) is **passed verbatim** to all targets. No content is filtered, adapted, or rewritten.

This means canonical bodies should contain **agent-agnostic instructions** — describe _what_ to do, not _how_ to do it with a specific agent's tools. For example, "run the tests before committing" is portable; "use the Bash tool to run tests" is Claude Code-specific and will land unchanged in Cursor, Copilot, and OpenCode where it won't make sense.

### Canonical vs native files

dotai also discovers **native agent-specific files** in source repos and passes them through byte-identical to only the matching agent:

| Agent          | Native rules                             | Native prompts                | Native agents               |
| -------------- | ---------------------------------------- | ----------------------------- | --------------------------- |
| Cursor         | `.cursor/rules/*.mdc`                    | —                             | —                           |
| GitHub Copilot | `.github/instructions/*.instructions.md` | `.github/prompts/*.prompt.md` | `.github/agents/*.agent.md` |
| Claude Code    | `.claude/rules/*.md`                     | `.claude/commands/*.md`       | `.claude/agents/*.md`       |
| OpenCode       | `.opencode/rules/*.md`                   | `.opencode/commands/*.md`     | `.opencode/agents/*.md`     |

A single source repo can contain both canonical and native files. Canonical files fan out to all targets; native files go only to their matching agent.

| Use case                                        | Approach                    |
| ----------------------------------------------- | --------------------------- |
| Agent-agnostic project-wide instructions        | Canonical `INSTRUCTIONS.md` |
| Agent-specific tool references or workflows     | Native file                 |
| Mix of portable and agent-specific instructions | Both in the same repo       |

### Per-agent overrides

Canonical files can include **agent-namespaced override blocks** in their YAML frontmatter. When transpiling for a target agent, its override fields are shallow-merged on top of the base fields. Overrides for other agents are stripped.

This lets you keep a single canonical file while tuning specific fields per agent, without maintaining separate native files.

```markdown
---
name: review-code
description: Review code for bugs and style issues
model: claude-sonnet-4
tools:
  - codebase_search
  - read_file

github-copilot:
  model: gpt-4o

claude-code:
  tools:
    - Read
    - Grep
---

Review the following code for correctness, performance, and style.
```

In this example, when transpiling for GitHub Copilot the effective `model` is `gpt-4o`. For Claude Code, the `tools` list uses Claude-specific tool names. For other agents, the base fields are used unchanged.

Override blocks work on the canonical types that support transpilation:

| Type              | Overridable fields                                                             |
| ----------------- | ------------------------------------------------------------------------------ |
| `PROMPT.md`       | `description`, `argument-hint`, `agent`, `model`, `tools`                      |
| `AGENT.md`        | `description`, `model`, `tools`, `disallowed-tools`, `max-turns`, `background` |
| `INSTRUCTIONS.md` | `description`                                                                  |

Identity fields (`name`, `schema-version`) and structural fields (`body`) cannot be overridden.

Override keys must match a valid target agent (`github-copilot`, `claude-code`, `cursor`, `opencode`). Unrecognized keys produce a parser warning.

Agent-exclusive fields like `disallowed-tools`, `max-turns`, and `background` can appear in any agent's override block. The transpiler for agents that do not support those fields ignores them, just as it does for base fields.

See [`examples/`](../examples) for complete working examples.

## Source repo layout

dotai discovers context files by convention. It scans the source path (the repo or directory you pass to `dotai add`) for files in specific locations.

### Prompts and agents

Each type is discovered in two places:

| Type    | Root file   | Subdirectory pattern  |
| ------- | ----------- | --------------------- |
| Prompts | `PROMPT.md` | `prompts/*/PROMPT.md` |
| Agents  | `AGENT.md`  | `agents/*/AGENT.md`   |

If a root-level file and a subdirectory file share the same `name` (from frontmatter), the root-level file takes priority.

### Instructions

Instructions are discovered only at the package root:

| Type         | Root file         | Subdirectory pattern |
| ------------ | ----------------- | -------------------- |
| Instructions | `INSTRUCTIONS.md` | _(none)_             |

Only one `INSTRUCTIONS.md` per package is supported. Subdirectory files are ignored.

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
  INSTRUCTIONS.md               # root-level instructions
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

Every canonical file (`PROMPT.md`, `AGENT.md`, `SKILL.md`, `INSTRUCTIONS.md`) must contain YAML frontmatter with at least `name` and `description`:

```markdown
---
name: project-setup
description: Project setup instructions for new contributors
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

### Instruction (`INSTRUCTIONS.md`)

```markdown
---
name: project-setup
description: Project setup instructions for new contributors
---

Follow these conventions when working in this repository.
```

Supported fields: `name` (required), `description` (required).

Instructions are appended as marker-delimited sections to project-wide files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`).

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
