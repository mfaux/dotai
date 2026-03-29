# Supported Targets

dotai installs `SKILL.md` files into the config directories of its supported targets. **GitHub Copilot**, **Claude Code**, **Codex**, **Cursor**, and **OpenCode** are actively tested.

Rules, prompts, and agent definitions use [transpilation targets](../README.md#supported-targets) (Copilot, Claude Code, Cursor, OpenCode).

<details>
<summary>Full target table</summary>

<!-- supported-agents:start -->

| Target         | `--targets`      | Project Path      | Global Path                  |
| -------------- | ---------------- | ----------------- | ---------------------------- |
| Claude Code    | `claude-code`    | `.claude/skills/` | `~/.claude/skills/`          |
| Codex          | `codex`          | `.agents/skills/` | `~/.codex/skills/`           |
| Cursor         | `cursor`         | `.agents/skills/` | `~/.cursor/skills/`          |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/`         |
| OpenCode       | `opencode`       | `.agents/skills/` | `~/.config/opencode/skills/` |

<!-- supported-agents:end -->

</details>

## Skill Discovery

The CLI searches for skills in these locations within a repository:

<!-- skill-discovery:start -->

- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.agents/skills/`
- `.claude/skills/`
- `.codex/skills/`
- `.cursor/skills/`
- `.github/skills/`
- `.opencode/skills/`
- Plugin manifest paths (`.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`)
<!-- skill-discovery:end -->
