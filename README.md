# dotai

Universal context distribution for AI coding agents.

<!-- agent-list:start -->

Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [37 more](docs/supported-agents.md).

<!-- agent-list:end -->

## Fork Lineage

`dotai` started as a near carbon-copy fork of `vercel-labs/skills` / `skills.sh`.
In plain terms: this project is basically `skills.sh` plus additive support for more kinds of AI agent context.

- **Inherited as-is:** mature skills install pipeline, multi-agent skill paths, discovery behavior, update/check flow, lock handling patterns, and agent registry tooling.
- **Added by dotai:** distribution beyond `SKILL.md` to additional context layers (rules, prompts, agents), plus transpilation and target-aware install behavior.

This means `skills.sh` workflows remain first-class, while `dotai` extends the model to broader AI context management.

## What dotai installs

| Layer   | Canonical file | Install behavior                     |
| ------- | -------------- | ------------------------------------ |
| Skills  | `SKILL.md`     | Passthrough (symlink or copy)        |
| Rules   | `RULES.md`     | Transpile per target agent           |
| Prompts | `PROMPT.md`    | Transpile per supported target agent |
| Agents  | `AGENT.md`     | Transpile per supported target agent |

## Quick Start

```bash
# Add context from a repository
npx dotai add owner/repo

# Target specific coding agents
npx dotai add owner/repo --agents copilot,claude,cursor

# Install specific rules or skills
npx dotai add owner/repo --rule code-style --skill db-migrate

# Preview without writing files
npx dotai add owner/repo --dry-run
```

## Source Formats

```bash
# GitHub shorthand (owner/repo)
npx dotai add vercel-labs/agent-skills

# Full GitHub URL
npx dotai add https://github.com/vercel-labs/agent-skills

# Direct path in a repository
npx dotai add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx dotai add https://gitlab.com/org/repo

# Any git URL
npx dotai add git@github.com:vercel-labs/agent-skills.git

# Local path
npx dotai add ./my-local-context
```

## Key Options

| Option                  | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `-g, --global`          | Install to user directory instead of project                |
| `-t, --type <types...>` | Filter by context type (`skill`, `rule`, `prompt`, `agent`) |
| `--agents <list>`       | Target transpilation agents (comma-separated)               |
| `--dry-run`             | Preview writes without making changes                       |
| `-y, --yes`             | Skip confirmation prompts                                   |
| `--all`                 | Shorthand for `--skill '*' --agent '*' -y`                  |

See [full CLI reference](docs/cli-reference.md) for all `add`, `remove`, and `list` options, examples, and team sharing workflows.

## Commands

| Command                        | Description                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `npx dotai add <package>`      | Discover, select, transpile, and install context (aliases: `install`, `i`, `a`) |
| `npx dotai remove [name]`      | Remove installed context (aliases: `rm`, `r`)                                   |
| `npx dotai list`               | List installed items (alias: `ls`)                                              |
| `npx dotai find [query]`       | Search for skills interactively (aliases: `search`, `f`, `s`)                   |
| `npx dotai check`              | Check for available updates (skills, rules, prompts, agents)                    |
| `npx dotai update`             | Update installed items to latest versions (alias: `upgrade`)                    |
| `npx dotai init [name]`        | Create a context template (skill by default)                                    |
| `npx dotai init rule [name]`   | Create a RULES.md template                                                      |
| `npx dotai init prompt [name]` | Create a PROMPT.md template                                                     |
| `npx dotai init agent [name]`  | Create an AGENT.md template                                                     |
| `npx dotai restore`            | Restore from lock files (alias: `experimental_install`)                         |
| `npx dotai experimental_sync`  | Sync from node_modules into agent skill dirs                                    |

## Supported Targets for Canonical Transpilation

| Agent          | Skills | Rules | Prompts                 | Agents                    |
| -------------- | ------ | ----- | ----------------------- | ------------------------- |
| GitHub Copilot | ✅     | ✅    | ✅                      | ✅                        |
| Claude Code    | ✅     | ✅    | ✅                      | ✅                        |
| Cursor         | ✅     | ✅    | ⚠️ (native/compat only) | ⚠️ (via `.github/agents`) |
| Windsurf       | ✅     | ✅    | ⚠️ (native passthrough) | —                         |
| Cline          | ✅     | ✅    | —                       | —                         |

- **Cursor prompts (native/compat only):** Cursor has no built-in prompt/command system. Native `.github/prompts/*.prompt.md` files are passed through (Cursor reads the Copilot path), but canonical `PROMPT.md` is not transpiled to a Cursor-specific format.
- **Cursor agents (via `.github/agents`):** Cursor reads agent definitions from the GitHub Copilot path (`.github/agents/`). Canonical `AGENT.md` files are transpiled to the Copilot format, which Cursor then picks up.
- **Windsurf prompts (native passthrough):** Windsurf workflows (`.windsurf/workflows/*.md`) use a native format that differs from canonical `PROMPT.md`. Only native passthrough is supported — no canonical-to-Windsurf prompt transpilation.

See [full CLI reference](docs/cli-reference.md) for details on how transpilation works, canonical vs native files, and the canonical authoring format.

## Environment Variables

| Variable                             | Description                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `GITHUB_TOKEN` / `GH_TOKEN`          | GitHub API token for authenticated requests (private repos)        |
| `INSTALL_INTERNAL_SKILLS`            | Include skills marked `metadata.internal: true` (`1` or `true`)    |
| `CODEX_HOME`                         | Override Codex config directory (default: `~/.codex`)              |
| `CLAUDE_CONFIG_DIR`                  | Override Claude config directory (default: `~/.claude`)            |
| `SKILLS_API_URL`                     | Override skills search API base URL (default: `https://skills.sh`) |
| `DISABLE_TELEMETRY` / `DO_NOT_TRACK` | Disable anonymous usage telemetry                                  |

## Related Links

- [Upstream fork source: vercel-labs/skills](https://github.com/vercel-labs/skills)
- [skills.sh](https://skills.sh)
- [Agent Skills specification](https://agentskills.io)

## License

MIT
