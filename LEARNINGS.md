# LEARNINGS.md

Mistakes and lessons learned during development. Read this file into context at the start of every session to avoid repeating past errors.

## Format

Each entry should include:

- **Date**: When the mistake was made
- **What went wrong**: Brief description of the error
- **Root cause**: Why it happened
- **Fix / Prevention**: How to avoid it in the future

---

<!-- Add new entries below this line, newest first -->

### 2026-03-03 — Import extension `.js` vs `.ts` broke 167 subprocess tests

- **What went wrong**: New imports of `lock-version-error.ts` in source files (`dotai-lock.ts`, `local-lock.ts`, `skill-lock.ts`) used `.js` extension (`from './lock-version-error.js'`), causing `ERR_MODULE_NOT_FOUND` when the CLI was run via `node --experimental-strip-types src/cli.ts` (which is how subprocess/integration tests invoke the CLI).
- **Root cause**: The `.js` extension convention works in bundler-mode TypeScript and in vitest (which has its own resolver), but `node --experimental-strip-types` does NOT rewrite `.js` → `.ts` in import specifiers. The existing codebase uses `.ts` extensions for runtime (value) imports in source files. Type-only imports (`import type ... from './foo.js'`) are erased entirely and never cause issues. The `.js` extension was likely copied from the test files or the `import type` statement, where it works fine.
- **Fix / Prevention**: Always use `.ts` extensions for runtime imports in source files in this codebase. Check existing source files for the prevailing import extension convention before adding new imports. The `.js` extension pattern is only safe for type-only imports (erased at runtime) and in test files (run by vitest).

### 2026-03-02 — Plan Task 24 analysis was incorrect (glob/activation handling)

- **What went wrong**: Plan claimed Claude Code transpilers were inconsistent with other transpilers by emitting globs regardless of `activation` mode, and recommended standardizing all transpilers to check `rule.activation === 'glob'`. Investigation showed Claude Code's behavior is intentionally different and correct.
- **Root cause**: Claude Code treats `globs` as independent "file scoping" — orthogonal to activation mode (which is driven by the `description` field for model-based decisions). Other agents (Cursor, Windsurf, Cline) tie globs to the `activation: 'glob'` mode. The plan treated all agents uniformly when they have different semantics. There was an explicit test at `rule-transpilers.test.ts:538` asserting the intentional behavior with a comment: "Claude Code append shows globs whenever they exist, regardless of activation."
- **Fix / Prevention**: Check for existing tests that assert the current behavior before assuming it's a bug. When a plan says behavior is "inconsistent," verify whether the inconsistency is intentional (different agents with different semantics) vs. accidental (copy-paste error). This is the second time a plan task's analysis was wrong (Task 8 was the first) — always verify before implementing.

### 2026-03-02 — Plan Task 8 analysis was incorrect

- **What went wrong**: Plan claimed `getPluginGroupings` stores file paths instead of directory paths, and recommended applying `dirname()` to fix it. Investigation showed the code was already correct.
- **Root cause**: The plan compared `getPluginGroupings` with `getPluginSkillPaths` and noted that `getPluginSkillPaths` uses `dirname()` while `getPluginGroupings` does not. But these two functions have different purposes — `getPluginSkillPaths` returns parent directories to search in, while `getPluginGroupings` maps skill directories to plugin names. The `dirname()` usage is intentionally different.
- **Fix / Prevention**: Always verify plan claims against the actual code and tests before applying fixes. Write a failing test first (per AGENTS.md guidelines) — if you can't write a failing test, the bug may not exist. Run integration tests to confirm the reported behavior actually occurs.
