---
name: project-conventions
description: Project-wide coding conventions for all contributors
---

<!-- Keep instructions agent-agnostic. Avoid referencing agent-specific tools
     or workflows. Use native files (e.g. .cursor/rules/*.mdc) for
     agent-specific content. -->

Follow these conventions when working in this repository.

## Code Style

Use `const` over `let` when the variable is never reassigned.

Prefer `interface` over `type` for object shapes that may be extended.

Use explicit return types on exported functions.

## Testing

Write tests for all new features and bug fixes.

Run the full test suite before submitting changes.

## Commits

Use conventional commit messages (e.g., `feat: add feature`, `fix: resolve bug`).
