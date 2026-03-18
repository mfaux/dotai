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
| `-a, --agent <agents...>`   | Specify install agents (use `'*'` for all agents)                            |
| `--agents <list>`           | Target rule/prompt/agent transpilation agents (comma-separated)              |
| `-l, --list`                | List available items without installing                                      |
| `--copy`                    | Copy files instead of symlinking skills                                      |
| `--dry-run`                 | Preview writes without making changes                                        |
| `--force`                   | Overwrite conflicting managed/unmanaged outputs                              |
| `--append`                  | Append rules to `AGENTS.md`/`CLAUDE.md` instead of per-rule files            |
| `--gitignore`               | Add transpiled output paths to `.gitignore` (managed section)                |
| `--full-depth`              | Search all subdirectories even when a root `SKILL.md` exists                 |
| `-y, --yes`                 | Skip confirmation prompts                                                    |
| `--all`                     | Shorthand for `--skill '*' --agent '*' -y`                                   |

> **`--agent` vs `--agents`:** These serve different purposes. `--agent` / `-a` selects which of the 40+ skill-install agents to target (e.g., `--agent cursor,claude-code`). `--agents` selects which of the 5 transpilation targets (copilot, claude, cursor, windsurf, cline) receive transpiled rule/prompt/agent output. When omitted, all 5 transpilation targets are used.

> **`--append`:** Instead of writing individual rule files (e.g., `.github/instructions/code-style.instructions.md`), rules are appended as marker-delimited sections into `AGENTS.md` (Copilot) and `CLAUDE.md` (Claude Code). Useful for projects that prefer a single monolithic instruction file. Only applies to Copilot and Claude Code targets; other agents always get individual files.

> **`--gitignore`:** Adds transpiled output file paths to a managed `# dotai:start` / `# dotai:end` section in `.gitignore`. Use when transpiled outputs should not be committed — only the canonical source files and `.dotai-lock.json` are checked in, and teammates run `dotai add` to regenerate outputs locally.

<!-- agent-names:start -->

Supported agent aliases include values such as `claude-code` and `codex`. See [Supported Agents](supported-agents.md).

<!-- agent-names:end -->

## remove command options

| Option                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `-g, --global`            | Remove from global scope                                                     |
| `-a, --agent <agents...>` | Remove from specific agents (use `'*'` for all agents)                       |
| `-t, --type <types...>`   | Filter by context type (`skill`, `rule`, `prompt`, `agent`; comma-separated) |
| `-y, --yes`               | Skip confirmation prompts                                                    |
| `--all`                   | Remove all installed items                                                   |

## list command options

| Option                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `-g, --global`            | List global context (default: project)                                       |
| `-a, --agent <agents...>` | Filter by specific agents                                                    |
| `-t, --type <types...>`   | Filter by context type (`skill`, `rule`, `prompt`, `agent`; comma-separated) |

## Installation Scope

| Scope   | Flag      | Typical location                                 | Use case               |
| ------- | --------- | ------------------------------------------------ | ---------------------- |
| Project | (default) | `./<agent>/skills/` and transpiled local outputs | Shared with repository |
| Global  | `-g`      | `~/<agent>/skills/` and global targets           | Reuse across projects  |

## Examples

```bash
# List available context in a source repository
npx dotai add owner/repo --list

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
npx dotai add owner/repo --all --agents copilot,claude,cursor,windsurf,cline -y
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
| Windsurf       | `.windsurf/rules/*.md`                   | `.windsurf/workflows/*.md`    | —                           |
| Cline          | `.clinerules/*.md`                       | —                             | —                           |

A single source repo can contain both canonical and native files. Canonical files fan out to all target agents; native files go only to their matching agent.

| Use case                                        | Approach              |
| ----------------------------------------------- | --------------------- |
| Agent-agnostic coding standards                 | Canonical `RULES.md`  |
| Agent-specific tool references or workflows     | Native file           |
| Mix of portable and agent-specific instructions | Both in the same repo |

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

| `activation` | Cursor              | Windsurf                  | Copilot            | Claude Code         | Cline                     |
| ------------ | ------------------- | ------------------------- | ------------------ | ------------------- | ------------------------- |
| `always`     | `alwaysApply: true` | `trigger: always_on`      | `applyTo: "**"`    | always applies      | always applies            |
| `auto`       | agent decides       | `trigger: model_decision` | `applyTo: "**"`    | agent decides       | always applies            |
| `manual`     | manual inclusion    | `trigger: manual`         | `applyTo: "**"`    | manual              | always applies            |
| `glob`       | `globs: <patterns>` | `trigger: glob`           | `applyTo: <globs>` | `globs: <patterns>` | `**Applies to:** <globs>` |

> **Note:** Cline uses plain markdown with no structured metadata, so all activation modes result in a rule that is always visible to the agent. Claude Code treats `globs` as independent file scoping — globs are emitted whenever present, regardless of activation mode.

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
