# dotai

Share AI agent context across tools and teams.

dotai takes canonical context files — skills, rules, prompts, and agent
definitions — and installs them into the config directories of 40+ AI coding
agents. Write once, distribute everywhere. Your team gets consistent AI behavior
across Copilot, Claude Code, Cursor, and dozens more.

Requires Node.js 18+ (or Bun/Deno).

<!-- agent-list:start -->

Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [37 more](docs/supported-agents.md).

<!-- agent-list:end -->

## Try It Now

```bash
npx dotai add owner/repo           # install context from any GitHub repo
npx dotai add owner/repo --dry-run # preview without writing files
```

## Why dotai?

AI coding agents each store context in different places with different formats.
Keeping rules, prompts, and skills in sync across agents is manual and
error-prone.

dotai solves this with **canonical authoring**: write a single `RULES.md`,
`PROMPT.md`, or `AGENT.md` and dotai transpiles it into every target agent's
native format automatically.

- **Write once** — one canonical file fans out to all target agents
- **40+ agents** — Copilot, Claude Code, Cursor, Windsurf, Cline, and more
- **Team sharing** — `npx dotai add owner/repo` gives every teammate the same context
- **No lock-in** — canonical files are plain markdown with YAML frontmatter

## Install

```bash
npm install -g dotai        # install globally for regular use
npx dotai                   # run without installing
```

## Get Started

```bash
# Add context from a GitHub repo
npx dotai add owner/repo

# Target specific coding agents
npx dotai add owner/repo --targets copilot,claude,cursor

# Install specific rules or skills
npx dotai add owner/repo --rule code-style --skill db-migrate
```

dotai discovers skills, rules, prompts, and agent definitions in the source
repo and transpiles them for your selected targets.

## What dotai installs

| Layer   | Canonical file | Install behavior                     |
| ------- | -------------- | ------------------------------------ |
| Skills  | `SKILL.md`     | Passthrough (symlink or copy)        |
| Rules   | `RULES.md`     | Transpile per target agent           |
| Prompts | `PROMPT.md`    | Transpile per supported target agent |
| Agents  | `AGENT.md`     | Transpile per supported target agent |

See [Source repo layout](docs/cli-reference.md#source-repo-layout) for where to place these files in your repo so dotai discovers them.

## Source Formats

dotai accepts sources in many formats:

```bash
npx dotai add vercel-labs/agent-skills                  # GitHub shorthand
npx dotai add https://github.com/vercel-labs/agent-skills  # full URL
npx dotai add https://gitlab.com/org/repo               # GitLab
npx dotai add git@github.com:org/repo.git               # any git URL
npx dotai add ./my-local-context                        # local path
```

## Commands

| Command         | Description                                            |
| --------------- | ------------------------------------------------------ |
| `add <package>` | Discover, select, transpile, and install context       |
| `remove [name]` | Remove installed context                               |
| `list`          | List installed items                                   |
| `find [query]`  | Search for skills interactively                        |
| `check`         | Check for available updates                            |
| `update`        | Update installed items to latest versions              |
| `init [name]`   | Create a context template (skill, rule, prompt, agent) |
| `restore`       | Restore from lock files                                |

## Supported Targets

<details>
<summary>Transpilation support by agent</summary>

| Agent          | Skills | Rules | Prompts                 | Agents                    |
| -------------- | ------ | ----- | ----------------------- | ------------------------- |
| GitHub Copilot | ✅     | ✅    | ✅                      | ✅                        |
| Claude Code    | ✅     | ✅    | ✅                      | ✅                        |
| Cursor         | ✅     | ✅    | ⚠️ (native/compat only) | ⚠️ (via `.github/agents`) |
| Windsurf       | ✅     | ✅    | ⚠️ (native passthrough) | —                         |
| Cline          | ✅     | ✅    | —                       | —                         |

- **Cursor prompts:** Cursor reads Copilot's `.github/prompts/` path. Canonical `PROMPT.md` is not transpiled to a Cursor-specific format.
- **Cursor agents:** Cursor reads `.github/agents/` from the Copilot path. Canonical `AGENT.md` transpiles to Copilot format, which Cursor picks up.
- **Windsurf prompts:** Windsurf workflows use a native format. Only passthrough is supported.

</details>

Skill installs target [41 agents](docs/supported-agents.md). **GitHub Copilot**, **Claude Code**, and **OpenCode** are actively tested; other agents follow the [Agent Skills specification](https://agentskills.io) but are not individually verified.

## Reference

- [CLI Reference](docs/cli-reference.md) — all commands, flags, options, and authoring format
- [Supported Agents](docs/supported-agents.md) — full list of skill install targets

## Fork Lineage

dotai started as a fork of [vercel-labs/skills](https://github.com/vercel-labs/skills) / [skills.sh](https://skills.sh).
The inherited skills install pipeline remains first-class. dotai extends it with
transpilation of rules, prompts, and agent definitions to multiple target agents.

## Acknowledgements

- [vercel-labs/skills](https://github.com/vercel-labs/skills) — upstream fork source
- [skills.sh](https://skills.sh) — skill discovery and search
- [Agent Skills specification](https://agentskills.io)

## License

MIT
