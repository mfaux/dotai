<!-- Canonical prompt: $ARGUMENTS and tool names are mapped per-agent during
     transpilation. The model field uses canonical names (e.g. claude-sonnet-4)
     that resolve to agent-specific identifiers automatically. -->

---

name: review-pr
description: Review a pull request for correctness, performance, and style
argument-hint: <file-or-directory>
tools:

- codebase_search
- read_file
  model: claude-sonnet-4

---

Review the code at $ARGUMENTS for:

1. **Correctness** — Logic errors, edge cases, off-by-one errors
2. **Performance** — Unnecessary allocations, O(n²) loops, missing memoization
3. **Style** — Naming clarity, consistent patterns, dead code
4. **Security** — Input validation, injection risks, secret exposure

Provide a summary with severity labels (critical / warning / nit).
