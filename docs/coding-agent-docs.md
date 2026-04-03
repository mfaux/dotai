# Coding Agent Documentation

Links to official documentation for the context surfaces that dotai supports, organized by coding agent.

## Context Surfaces

dotai transpiles canonical content types into agent-native formats. The table below maps each surface to its documentation across agents.

### Instructions

Project-wide instruction files loaded into every session (e.g., `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`).

| Agent          | Docs                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode       | [Rules (AGENTS.md)](https://opencode.ai/docs/rules/)                                                                                   |
| Claude Code    | [CLAUDE.md & Memory](https://code.claude.com/docs/en/memory)                                                                           |
| Codex          | [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)                                                                      |
| Cursor         | [Rules (AGENTS.md)](https://cursor.com/docs/rules#agentsmd)                                                                            |
| GitHub Copilot | [Custom Instructions](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) |

### Agent-Native Rules

Scoped instruction files with activation conditions, specific to each coding agent. dotai discovers these as native passthrough files when they exist in a source repo.

| Agent          | Docs                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode       | [Rules](https://opencode.ai/docs/rules/) — `AGENTS.md` + `opencode.json` `instructions` field                                                                                                                                                                             |
| Claude Code    | [Rules (.claude/rules/)](https://code.claude.com/docs/en/memory#organize-rules-with-clauderules) — path-scoped `.md` files with `paths` frontmatter                                                                                                                       |
| Codex          | [Rules](https://developers.openai.com/codex/rules) — `.rules` files under `.codex/rules/` using Starlark `prefix_rule()`                                                                                                                                                  |
| Cursor         | [Project Rules](https://cursor.com/docs/rules#project-rules) — `.mdc` files in `.cursor/rules/` with `description`, `globs`, `alwaysApply` frontmatter                                                                                                                    |
| GitHub Copilot | [Path-specific Instructions](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot#creating-path-specific-custom-instructions) — `.instructions.md` files in `.github/instructions/` with `applyTo` frontmatter |

### Skills

On-demand, reusable `SKILL.md` packages loaded by the agent when relevant.

| Agent          | Docs                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| OpenCode       | [Agent Skills](https://opencode.ai/docs/skills/) — `.opencode/skills/`, `.agents/skills/`           |
| Claude Code    | [Skills](https://code.claude.com/docs/en/skills) — `.claude/skills/`, `.agents/skills/`             |
| Codex          | [Agent Skills](https://developers.openai.com/codex/skills) — `.agents/skills/`, `~/.agents/skills/` |
| Cursor         | [Agent Skills](https://cursor.com/docs/context/skills) — `.cursor/skills/`, `.agents/skills/`       |
| GitHub Copilot | `.agents/skills/` (via [Agent Skills spec](https://agentskills.io/))                                |

### Prompts / Commands

Reusable prompt templates invoked explicitly (e.g., `/command-name`).

| Agent          | Docs                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode       | [Commands](https://opencode.ai/docs/commands/) — `.opencode/commands/*.md` with `description`, `agent`, `model` frontmatter                                                                                               |
| Claude Code    | [Custom Commands](https://code.claude.com/docs/en/memory) — `.claude/commands/*.md` with description blockquote                                                                                                           |
| GitHub Copilot | [Prompt Files](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) — `.github/prompts/*.prompt.md` with `description`, `agent`, `model`, `tools` frontmatter |

### Agents / Subagents

Custom agent definitions with specialized prompts, tool restrictions, and models.

| Agent          | Docs                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode       | [Agents](https://opencode.ai/docs/agents/) — `.opencode/agents/*.md` or `opencode.json` `agent` field                                                                                                                |
| Claude Code    | [Subagents](https://code.claude.com/docs/en/sub-agents) — `.claude/agents/*.md` with `name`, `description`, `tools`, `model` frontmatter                                                                             |
| Codex          | [Subagents](https://developers.openai.com/codex/subagents) — `.codex/agents/*.toml` with `name`, `description`, `developer_instructions`                                                                             |
| GitHub Copilot | [Agent Mode](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) — `.github/agents/*.agent.md` with `name`, `description`, `model`, `tools` frontmatter |
