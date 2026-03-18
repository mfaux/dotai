# AGENTS.md

`dotai` is a CLI tool for universal context distribution to AI coding agents. It installs "skills" (SKILL.md), "rules" (RULES.md), "prompts" (PROMPT.md), and "agents" (AGENT.md) into the configuration directories of 40+ supported AI agents. It is a divergent fork of `vercel-labs/skills`.

## LEARNINGS.md

**Always read `LEARNINGS.md` into context at the start of every session.** This file tracks mistakes made during development so they are not repeated. When you make an error — a wrong assumption, a broken build, a misunderstood requirement, a flawed approach — log it in `LEARNINGS.md` with the date, what went wrong, the root cause, and how to prevent it in the future.

## AI-REQUESTS.md

**Log requests for unavailable tools or capabilities to `AI-REQUESTS.md`.** If a tool you need to complete your work is unavailable (e.g., a file search tool, a web fetch tool, or a shell capability), record the request in `AI-REQUESTS.md`. This does **not** apply to package libraries -- you may freely install those to complete development tasks.

## Guidelines

- **Bug fixes require a failing test first.** When fixing a bug, write a test that reproduces the bug and confirms it fails, then fix the code to make the test pass.
- **No unused code.** Do not leave unused functions, unused imports, or unused exports in source files. When you remove the last caller of a function, remove the function. When you remove a function, remove its `import` from any file that imported it. Do not add `export` to symbols that are only used within their own file.

## Development

```bash
pnpm dev <command>     # Run CLI locally (e.g. pnpm dev add, pnpm dev list)
pnpm test              # Run all tests (vitest)
pnpm type-check        # TypeScript type check
pnpm format            # Prettier — always run before committing
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
