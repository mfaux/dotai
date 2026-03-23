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

<!-- Per-agent overrides: the base fields apply to all target agents.
     Agent-namespaced blocks override specific fields when transpiling
     for that agent. -->

Use `const` over `let` when the variable is never reassigned.

Prefer `interface` over `type` for object shapes that may be extended.

Use explicit return types on exported functions.

Avoid `any` — use `unknown` when the type is truly unknown, then narrow with type guards.
