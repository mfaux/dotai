<!-- Canonical rule: the body below is installed verbatim to all 5 target agents.
     Keep instructions agent-agnostic — avoid referencing agent-specific tools
     or workflows. Use native files (e.g. .cursor/rules/*.mdc) for agent-specific content. -->

---

name: typescript-style
description: Enforce TypeScript coding style conventions
globs:

- '\*.ts'
- '\*.tsx'
  activation: always

---

Use `const` over `let` when the variable is never reassigned.

Prefer `interface` over `type` for object shapes that may be extended.

Use explicit return types on exported functions.

Avoid `any` — use `unknown` when the type is truly unknown, then narrow with type guards.
