# Supported Targets

dotai installs `SKILL.md` files into the config directories of 41 targets. **GitHub Copilot**, **Claude Code**, and **OpenCode** are actively tested; other targets follow the [Agent Skills specification](https://agentskills.io) but are not individually verified.

Rules, prompts, and agent definitions use a separate set of [transpilation targets](../README.md#supported-targets) (Copilot, Claude Code, Cursor, Windsurf, Cline, OpenCode). OpenCode is both a skill install target and a transpilation target.

<details>
<summary>Full target table</summary>

<!-- supported-agents:start -->

| Target                                | `--targets`                              | Project Path           | Global Path                     |
| ------------------------------------- | ---------------------------------------- | ---------------------- | ------------------------------- |
| Amp, Kimi Code CLI, Replit, Universal | `amp`, `kimi-cli`, `replit`, `universal` | `.agents/skills/`      | `~/.config/agents/skills/`      |
| Antigravity                           | `antigravity`                            | `.agent/skills/`       | `~/.gemini/antigravity/skills/` |
| Augment                               | `augment`                                | `.augment/skills/`     | `~/.augment/skills/`            |
| Claude Code                           | `claude-code`                            | `.claude/skills/`      | `~/.claude/skills/`             |
| OpenClaw                              | `openclaw`                               | `skills/`              | `~/.clawdbot/skills/`           |
| Cline                                 | `cline`                                  | `.agents/skills/`      | `~/.agents/skills/`             |
| CodeBuddy                             | `codebuddy`                              | `.codebuddy/skills/`   | `~/.codebuddy/skills/`          |
| Codex                                 | `codex`                                  | `.agents/skills/`      | `~/.codex/skills/`              |
| Command Code                          | `command-code`                           | `.commandcode/skills/` | `~/.commandcode/skills/`        |
| Continue                              | `continue`                               | `.continue/skills/`    | `~/.continue/skills/`           |
| Cortex Code                           | `cortex`                                 | `.cortex/skills/`      | `~/.snowflake/cortex/skills/`   |
| Crush                                 | `crush`                                  | `.crush/skills/`       | `~/.config/crush/skills/`       |
| Cursor                                | `cursor`                                 | `.agents/skills/`      | `~/.cursor/skills/`             |
| Droid                                 | `droid`                                  | `.factory/skills/`     | `~/.factory/skills/`            |
| Gemini CLI                            | `gemini-cli`                             | `.agents/skills/`      | `~/.gemini/skills/`             |
| GitHub Copilot                        | `github-copilot`                         | `.agents/skills/`      | `~/.copilot/skills/`            |
| Goose                                 | `goose`                                  | `.goose/skills/`       | `~/.config/goose/skills/`       |
| Junie                                 | `junie`                                  | `.junie/skills/`       | `~/.junie/skills/`              |
| iFlow CLI                             | `iflow-cli`                              | `.iflow/skills/`       | `~/.iflow/skills/`              |
| Kilo Code                             | `kilo`                                   | `.kilocode/skills/`    | `~/.kilocode/skills/`           |
| Kiro CLI                              | `kiro-cli`                               | `.kiro/skills/`        | `~/.kiro/skills/`               |
| Kode                                  | `kode`                                   | `.kode/skills/`        | `~/.kode/skills/`               |
| MCPJam                                | `mcpjam`                                 | `.mcpjam/skills/`      | `~/.mcpjam/skills/`             |
| Mistral Vibe                          | `mistral-vibe`                           | `.vibe/skills/`        | `~/.vibe/skills/`               |
| Mux                                   | `mux`                                    | `.mux/skills/`         | `~/.mux/skills/`                |
| OpenCode                              | `opencode`                               | `.agents/skills/`      | `~/.config/opencode/skills/`    |
| OpenHands                             | `openhands`                              | `.openhands/skills/`   | `~/.openhands/skills/`          |
| Pi                                    | `pi`                                     | `.pi/skills/`          | `~/.pi/agent/skills/`           |
| Qoder                                 | `qoder`                                  | `.qoder/skills/`       | `~/.qoder/skills/`              |
| Qwen Code                             | `qwen-code`                              | `.qwen/skills/`        | `~/.qwen/skills/`               |
| Roo Code                              | `roo`                                    | `.roo/skills/`         | `~/.roo/skills/`                |
| Trae                                  | `trae`                                   | `.trae/skills/`        | `~/.trae/skills/`               |
| Trae CN                               | `trae-cn`                                | `.trae/skills/`        | `~/.trae-cn/skills/`            |
| Windsurf                              | `windsurf`                               | `.windsurf/skills/`    | `~/.codeium/windsurf/skills/`   |
| Zencoder                              | `zencoder`                               | `.zencoder/skills/`    | `~/.zencoder/skills/`           |
| Neovate                               | `neovate`                                | `.neovate/skills/`     | `~/.neovate/skills/`            |
| Pochi                                 | `pochi`                                  | `.pochi/skills/`       | `~/.pochi/skills/`              |
| AdaL                                  | `adal`                                   | `.adal/skills/`        | `~/.adal/skills/`               |

<!-- supported-agents:end -->

</details>

> [!NOTE]
> **Kiro CLI users:** after installing skills, add them to your custom agent `resources` in `.kiro/agents/<agent>.json`.

## Skill Discovery

The CLI searches for skills in these locations within a repository:

<!-- skill-discovery:start -->

- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.agents/skills/`
- `.agent/skills/`
- `.augment/skills/`
- `.claude/skills/`
- `./skills/`
- `.codebuddy/skills/`
- `.commandcode/skills/`
- `.continue/skills/`
- `.cortex/skills/`
- `.crush/skills/`
- `.factory/skills/`
- `.goose/skills/`
- `.junie/skills/`
- `.iflow/skills/`
- `.kilocode/skills/`
- `.kiro/skills/`
- `.kode/skills/`
- `.mcpjam/skills/`
- `.vibe/skills/`
- `.mux/skills/`
- `.openhands/skills/`
- `.pi/skills/`
- `.qoder/skills/`
- `.qwen/skills/`
- `.roo/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zencoder/skills/`
- `.neovate/skills/`
- `.pochi/skills/`
- `.adal/skills/`
<!-- skill-discovery:end -->
