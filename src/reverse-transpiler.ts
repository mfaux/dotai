import matter from 'gray-matter';
import type { CanonicalRule, RuleActivation, TargetAgent } from './types.ts';
import { quoteYaml } from './rule-transpilers.ts';

// ---------------------------------------------------------------------------
// Reverse transpilers — native agent rule files → canonical CanonicalRule
//
// Each reverse transpiler reads an agent's native rule format and produces
// a CanonicalRule that can be serialized as a valid RULES.md file.
// ---------------------------------------------------------------------------

/**
 * Result of reverse-parsing a native rule file.
 */
export type ReverseParseResult = { ok: true; rule: CanonicalRule } | { ok: false; error: string };

/**
 * A reverse transpiler reads an agent's native rule format and produces
 * a CanonicalRule.
 */
export interface ReverseTranspiler {
  agent: TargetAgent;
  parse(content: string, filename: string): ReverseParseResult;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Convert a filename to a kebab-case name suitable for canonical rules.
 * Strips the given extension (or common extensions), lowercases,
 * and replaces spaces/underscores/dots with hyphens.
 */
export function toKebabCase(filename: string, extension?: string): string {
  let stem = filename;

  // Strip the specific extension if provided
  if (extension && stem.endsWith(extension)) {
    stem = stem.slice(0, -extension.length);
  } else {
    // Strip common extensions in order of specificity
    const extensions = ['.instructions.md', '.mdc', '.md'];
    for (const ext of extensions) {
      if (stem.endsWith(ext)) {
        stem = stem.slice(0, -ext.length);
        break;
      }
    }
  }

  return stem
    .toLowerCase()
    .replace(/[\s_.]+/g, '-') // spaces, underscores, dots → hyphens
    .replace(/-{2,}/g, '-') // collapse consecutive hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}

/**
 * Serialize a CanonicalRule into valid RULES.md content with YAML frontmatter.
 * The output round-trips through `parseRuleContent()`.
 */
export function serializeCanonicalRule(rule: CanonicalRule): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${rule.name}`);
  lines.push(`description: ${quoteYaml(rule.description)}`);

  if (rule.globs.length > 0) {
    lines.push('globs:');
    for (const glob of rule.globs) {
      lines.push(`  - '${glob}'`);
    }
  }

  lines.push(`activation: ${rule.activation}`);
  lines.push('---');
  lines.push('');

  if (rule.body) {
    lines.push(rule.body);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cursor reverse parser (.cursor/rules/*.mdc)
// ---------------------------------------------------------------------------

/**
 * Pre-process Cursor .mdc content to quote the globs field.
 * Cursor uses `globs: *.ts, *.tsx` which is invalid YAML (the * is
 * interpreted as a YAML alias). We quote the value before parsing.
 */
function quoteCursorGlobs(content: string): string {
  return content.replace(/^(globs:\s*)(.+)$/m, (_match, prefix: string, value: string) => {
    // Already quoted
    if (value.startsWith('"') || value.startsWith("'")) return _match;
    return `${prefix}"${value}"`;
  });
}

const cursorReverseTranspiler: ReverseTranspiler = {
  agent: 'cursor',

  parse(content: string, filename: string): ReverseParseResult {
    let data: Record<string, unknown>;
    let body: string;
    try {
      const parsed = matter(quoteCursorGlobs(content));
      data = parsed.data;
      body = parsed.content.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `invalid frontmatter: ${message}` };
    }

    const name = toKebabCase(filename, '.mdc');
    if (!name) {
      return { ok: false, error: 'could not derive name from filename' };
    }

    const description =
      typeof data.description === 'string' && data.description.length > 0
        ? data.description
        : `Imported from Cursor`;

    // Activation mapping:
    // alwaysApply: true → always
    // alwaysApply: false + globs → glob
    // alwaysApply: false + no globs → auto
    let activation: RuleActivation;
    let globs: string[] = [];

    if (data.alwaysApply === true) {
      activation = 'always';
    } else if (typeof data.globs === 'string' && data.globs.length > 0) {
      activation = 'glob';
      globs = data.globs
        .split(',')
        .map((g: string) => g.trim())
        .filter((g: string) => g.length > 0);
    } else {
      activation = 'auto';
    }

    return {
      ok: true,
      rule: {
        name,
        description,
        globs,
        activation,
        schemaVersion: 1,
        body,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Claude Code reverse parser (.claude/rules/*.md)
// ---------------------------------------------------------------------------

const claudeCodeReverseTranspiler: ReverseTranspiler = {
  agent: 'claude-code',

  parse(content: string, filename: string): ReverseParseResult {
    let data: Record<string, unknown>;
    let body: string;
    try {
      const parsed = matter(content);
      data = parsed.data;
      body = parsed.content.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `invalid frontmatter: ${message}` };
    }

    const name = toKebabCase(filename, '.md');
    if (!name) {
      return { ok: false, error: 'could not derive name from filename' };
    }

    const description =
      typeof data.description === 'string' && data.description.length > 0
        ? data.description
        : `Imported from Claude Code`;

    // Claude Code: globs present → glob; absent → always
    let activation: RuleActivation;
    let globs: string[] = [];

    if (Array.isArray(data.globs) && data.globs.length > 0) {
      activation = 'glob';
      globs = data.globs.filter((g): g is string => typeof g === 'string');
    } else {
      activation = 'always';
    }

    return {
      ok: true,
      rule: {
        name,
        description,
        globs,
        activation,
        schemaVersion: 1,
        body,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Copilot reverse parser (.github/instructions/*.instructions.md)
// ---------------------------------------------------------------------------

const copilotReverseTranspiler: ReverseTranspiler = {
  agent: 'github-copilot',

  parse(content: string, filename: string): ReverseParseResult {
    let data: Record<string, unknown>;
    let body: string;
    try {
      const parsed = matter(content);
      data = parsed.data;
      body = parsed.content.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `invalid frontmatter: ${message}` };
    }

    const name = toKebabCase(filename, '.instructions.md');
    if (!name) {
      return { ok: false, error: 'could not derive name from filename' };
    }

    const description = 'Imported from GitHub Copilot';

    // applyTo: "**" → always; otherwise → glob
    let activation: RuleActivation;
    let globs: string[] = [];

    const applyTo = typeof data.applyTo === 'string' ? data.applyTo : '**';

    if (applyTo === '**') {
      activation = 'always';
    } else {
      activation = 'glob';
      globs = applyTo
        .split(',')
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
    }

    return {
      ok: true,
      rule: {
        name,
        description,
        globs,
        activation,
        schemaVersion: 1,
        body,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Windsurf reverse parser (.windsurf/rules/*.md)
// ---------------------------------------------------------------------------

const windsurfReverseTranspiler: ReverseTranspiler = {
  agent: 'windsurf',

  parse(content: string, filename: string): ReverseParseResult {
    let data: Record<string, unknown>;
    let body: string;
    try {
      const parsed = matter(content);
      data = parsed.data;
      body = parsed.content.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `invalid frontmatter: ${message}` };
    }

    const name = toKebabCase(filename, '.md');
    if (!name) {
      return { ok: false, error: 'could not derive name from filename' };
    }

    const description =
      typeof data.description === 'string' && data.description.length > 0
        ? data.description
        : `Imported from Windsurf`;

    // Trigger mapping: always_on → always, model_decision → auto, manual → manual, glob → glob
    let activation: RuleActivation;
    let globs: string[] = [];
    const trigger = typeof data.trigger === 'string' ? data.trigger : 'always_on';

    switch (trigger) {
      case 'always_on':
        activation = 'always';
        break;
      case 'model_decision':
        activation = 'auto';
        break;
      case 'manual':
        activation = 'manual';
        break;
      case 'glob':
        activation = 'glob';
        if (Array.isArray(data.globs)) {
          globs = data.globs.filter((g): g is string => typeof g === 'string');
        }
        break;
      default:
        activation = 'always';
    }

    return {
      ok: true,
      rule: {
        name,
        description,
        globs,
        activation,
        schemaVersion: 1,
        body,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Cline reverse parser (.clinerules/*.md)
// ---------------------------------------------------------------------------

const clineReverseTranspiler: ReverseTranspiler = {
  agent: 'cline',

  parse(content: string, filename: string): ReverseParseResult {
    // Cline files are plain markdown — no YAML frontmatter
    const lines = content.split('\n');

    let name: string | undefined;
    let description: string | undefined;
    let globs: string[] = [];
    let activation: RuleActivation = 'always';
    const bodyLines: string[] = [];
    let headerParsed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Extract name from first # heading
      if (!name && /^#\s+/.test(line)) {
        name = toKebabCase(line.replace(/^#\s+/, '').trim());
        continue;
      }

      // Extract description from first > blockquote (after heading)
      if (name && !description && /^>\s+/.test(line)) {
        description = line.replace(/^>\s+/, '').trim();
        continue;
      }

      // Extract globs from **Applies to:** line
      if (!headerParsed && /^\*\*Applies to:\*\*/.test(line)) {
        const globMatch = line.match(/`([^`]+)`/g);
        if (globMatch) {
          globs = globMatch.map((g) => g.replace(/`/g, ''));
          activation = 'glob';
        }
        headerParsed = true;
        continue;
      }

      // Once we've seen the header lines, collect body
      // Skip leading empty lines after header
      if (name) {
        if (!headerParsed && line.trim() === '') {
          continue;
        }
        headerParsed = true;
        bodyLines.push(line);
      }
    }

    // Fallback name from filename if no heading found
    if (!name) {
      name = toKebabCase(filename, '.md');
    }
    if (!name) {
      return { ok: false, error: 'could not derive name from file' };
    }

    if (!description) {
      description = 'Imported from Cline';
    }

    // Trim leading/trailing empty lines from body
    const body = bodyLines.join('\n').trim();

    return {
      ok: true,
      rule: {
        name,
        description,
        globs,
        activation,
        schemaVersion: 1,
        body,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const reverseTranspilers: Record<TargetAgent, ReverseTranspiler> = {
  cursor: cursorReverseTranspiler,
  'claude-code': claudeCodeReverseTranspiler,
  'github-copilot': copilotReverseTranspiler,
  windsurf: windsurfReverseTranspiler,
  cline: clineReverseTranspiler,
};
