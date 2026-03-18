import { describe, it, expect } from 'vitest';
import { parseAgentContent } from './agent-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentmd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`;
    }
    if (typeof value === 'boolean') {
      return `${key}: ${value}`;
    }
    if (typeof value === 'number') {
      return `${key}: ${value}`;
    }
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const VALID_FRONTMATTER = {
  name: 'architect',
  description: 'Senior architect for system design and code review',
  model: 'claude-sonnet-4',
  tools: ['Read', 'Grep'],
  'disallowed-tools': ['Edit'],
  'max-turns': 25,
  background: false,
};

const MINIMAL_FRONTMATTER = {
  name: 'architect',
  description: 'Senior architect for system design and code review',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parseAgentContent — valid agents', () => {
  it('parses a fully specified AGENT.md', () => {
    const content = agentmd(VALID_FRONTMATTER, 'You are a senior software architect...');
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent).toEqual({
      name: 'architect',
      description: 'Senior architect for system design and code review',
      model: 'claude-sonnet-4',
      tools: ['Read', 'Grep'],
      disallowedTools: ['Edit'],
      maxTurns: 25,
      background: false,
      body: 'You are a senior software architect...',
      raw: content,
    });
  });

  it('parses an AGENT.md with only required fields', () => {
    const content = agentmd(MINIMAL_FRONTMATTER, 'You are an agent.');
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.agent).toEqual({
      name: 'architect',
      description: 'Senior architect for system design and code review',
      body: 'You are an agent.',
      raw: content,
    });
    expect(result.agent.model).toBeUndefined();
    expect(result.agent.tools).toBeUndefined();
    expect(result.agent.disallowedTools).toBeUndefined();
    expect(result.agent.maxTurns).toBeUndefined();
    expect(result.agent.background).toBeUndefined();
  });

  it('accepts empty body', () => {
    const content = agentmd(MINIMAL_FRONTMATTER);
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.body).toBe('');
  });

  it('preserves body exactly (no transformation)', () => {
    const body = 'Review code for:\n\n1. Bugs\n2. Performance\n\nUse tools wisely.';
    const content = agentmd(MINIMAL_FRONTMATTER, body);
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.body).toBe(body);
  });

  it('trims trailing whitespace from body', () => {
    const content = agentmd(MINIMAL_FRONTMATTER, 'Body text  \n\n');
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.body).toBe('Body text');
  });

  it('stores raw content for hashing', () => {
    const content = agentmd(VALID_FRONTMATTER, 'System prompt here.');
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.raw).toBe(content);
  });

  it('preserves model field as-is (no resolution at parse time)', () => {
    const content = agentmd({ ...MINIMAL_FRONTMATTER, model: 'gpt-4o-mini' });
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.model).toBe('gpt-4o-mini');
  });

  it('accepts background: true', () => {
    const content = agentmd({ ...MINIMAL_FRONTMATTER, background: true });
    const result = parseAgentContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.background).toBe(true);
  });

  it('accepts single-word kebab-case name', () => {
    const content = agentmd({ ...MINIMAL_FRONTMATTER, name: 'reviewer' });
    const result = parseAgentContent(content);
    expect(result.ok).toBe(true);
  });

  it('accepts name with numbers and hyphens', () => {
    const content = agentmd({ ...MINIMAL_FRONTMATTER, name: 'agent-1-2-3' });
    const result = parseAgentContent(content);
    expect(result.ok).toBe(true);
  });

  it('accepts schema-version: 1 explicitly', () => {
    const content = agentmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1 });
    const result = parseAgentContent(content);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — name validation', () => {
  it('rejects missing name', () => {
    const { name: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parseAgentContent(agentmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: name' });
  });

  it('rejects empty name', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name exceeding 128 characters', () => {
    const longName = 'a'.repeat(129);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: longName }));
    expect(result).toEqual({ ok: false, error: 'name exceeds 128 characters' });
  });

  it('accepts name at exactly 128 characters', () => {
    const maxName = 'a'.repeat(128);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: maxName }));
    expect(result.ok).toBe(true);
  });

  it('rejects name not in kebab-case (uppercase)', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 'My-Agent' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-agent")',
    });
  });

  it('rejects name with underscores', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 'my_agent' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-agent")',
    });
  });

  it('rejects name with spaces', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 'my agent' }));
    expect(result).toEqual({
      ok: false,
      error: 'name must be kebab-case (lowercase alphanumeric and hyphens, e.g. "my-agent")',
    });
  });

  it('rejects name with leading hyphen', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: '-architect' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with trailing hyphen', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 'architect-' }));
    expect(result.ok).toBe(false);
  });

  it('rejects name with consecutive hyphens', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 'my--agent' }));
    expect(result.ok).toBe(false);
  });

  it('rejects numeric name (YAML parses bare numbers)', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, name: 123 }));
    expect(result).toEqual({ ok: false, error: 'name must be a string' });
  });
});

// ---------------------------------------------------------------------------
// Description validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — description validation', () => {
  it('rejects missing description', () => {
    const { description: _, ...fm } = MINIMAL_FRONTMATTER;
    const result = parseAgentContent(agentmd(fm));
    expect(result).toEqual({ ok: false, error: 'missing required field: description' });
  });

  it('rejects empty description', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, description: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects description exceeding 512 characters', () => {
    const longDesc = 'x'.repeat(513);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, description: longDesc }));
    expect(result).toEqual({ ok: false, error: 'description exceeds 512 characters' });
  });

  it('accepts description at exactly 512 characters', () => {
    const maxDesc = 'x'.repeat(512);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, description: maxDesc }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — model validation', () => {
  it('rejects non-string model', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, model: 42 }));
    expect(result).toEqual({ ok: false, error: 'model must be a string' });
  });

  it('rejects model exceeding 128 characters', () => {
    const longModel = 'x'.repeat(129);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, model: longModel }));
    expect(result).toEqual({ ok: false, error: 'model exceeds 128 characters' });
  });

  it('accepts any string model value', () => {
    for (const model of ['claude-sonnet-4', 'gpt-4o', 'gemini-2.0-flash']) {
      const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, model }));
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tools validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — tools validation', () => {
  it('rejects non-array tools', () => {
    const content = `---
name: architect
description: Senior architect
tools: "Read"
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'tools must be an array of strings' });
  });

  it('rejects tools with non-string entries', () => {
    const content = `---
name: architect
description: Senior architect
tools:
  - 123
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'tools[0] must be a string' });
  });

  it('rejects tools exceeding 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, tools: tooMany }));
    expect(result).toEqual({ ok: false, error: 'tools exceeds 50 entries' });
  });

  it('accepts tools at exactly 50 entries', () => {
    const maxTools = Array.from({ length: 50 }, (_, i) => `Tool${i}`);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, tools: maxTools }));
    expect(result.ok).toBe(true);
  });

  it('rejects individual tool name exceeding 128 characters', () => {
    const longTool = 'T'.repeat(129);
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, tools: [longTool] }));
    expect(result).toEqual({ ok: false, error: 'tools[0] exceeds 128 characters' });
  });
});

// ---------------------------------------------------------------------------
// Disallowed-tools validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — disallowed-tools validation', () => {
  it('rejects non-array disallowed-tools', () => {
    const content = `---
name: architect
description: Senior architect
disallowed-tools: "Edit"
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'disallowed-tools must be an array of strings' });
  });

  it('rejects disallowed-tools with non-string entries', () => {
    const content = `---
name: architect
description: Senior architect
disallowed-tools:
  - 123
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'disallowed-tools[0] must be a string' });
  });

  it('rejects disallowed-tools exceeding 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
    const result = parseAgentContent(
      agentmd({ ...MINIMAL_FRONTMATTER, 'disallowed-tools': tooMany })
    );
    expect(result).toEqual({ ok: false, error: 'disallowed-tools exceeds 50 entries' });
  });

  it('accepts disallowed-tools at exactly 50 entries', () => {
    const maxTools = Array.from({ length: 50 }, (_, i) => `Tool${i}`);
    const result = parseAgentContent(
      agentmd({ ...MINIMAL_FRONTMATTER, 'disallowed-tools': maxTools })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects individual disallowed-tool name exceeding 128 characters', () => {
    const longTool = 'T'.repeat(129);
    const result = parseAgentContent(
      agentmd({ ...MINIMAL_FRONTMATTER, 'disallowed-tools': [longTool] })
    );
    expect(result).toEqual({
      ok: false,
      error: 'disallowed-tools[0] exceeds 128 characters',
    });
  });
});

// ---------------------------------------------------------------------------
// Max-turns validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — max-turns validation', () => {
  it('rejects non-integer max-turns', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': 2.5 }));
    expect(result).toEqual({ ok: false, error: 'max-turns must be a positive integer' });
  });

  it('rejects zero max-turns', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': 0 }));
    expect(result).toEqual({ ok: false, error: 'max-turns must be a positive integer' });
  });

  it('rejects negative max-turns', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': -5 }));
    expect(result).toEqual({ ok: false, error: 'max-turns must be a positive integer' });
  });

  it('rejects max-turns exceeding 1000', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': 1001 }));
    expect(result).toEqual({ ok: false, error: 'max-turns exceeds 1000' });
  });

  it('accepts max-turns at exactly 1000', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': 1000 }));
    expect(result.ok).toBe(true);
  });

  it('accepts max-turns of 1', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'max-turns': 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.maxTurns).toBe(1);
  });

  it('rejects string max-turns', () => {
    const content = `---
name: architect
description: Senior architect
max-turns: "25"
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'max-turns must be a positive integer' });
  });
});

// ---------------------------------------------------------------------------
// Background validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — background validation', () => {
  it('rejects non-boolean background', () => {
    const content = `---
name: architect
description: Senior architect
background: "true"
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'background must be a boolean' });
  });

  it('rejects numeric background', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, background: 1 }));
    expect(result).toEqual({ ok: false, error: 'background must be a boolean' });
  });

  it('accepts background: false', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, background: false }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.background).toBe(false);
  });

  it('accepts background: true', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, background: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.background).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema version validation
// ---------------------------------------------------------------------------

describe('parseAgentContent — schema-version validation', () => {
  it('rejects unsupported future schema-version', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported schema-version 2');
    expect(result.error).toContain('upgrade dotai');
  });

  it('rejects schema-version 0', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 0 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be >= 1' });
  });

  it('rejects non-integer schema-version', () => {
    const result = parseAgentContent(agentmd({ ...MINIMAL_FRONTMATTER, 'schema-version': 1.5 }));
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });

  it('rejects string schema-version', () => {
    const content = `---
name: architect
description: Senior architect
schema-version: "1"
---
`;
    const result = parseAgentContent(content);
    expect(result).toEqual({ ok: false, error: 'schema-version must be an integer' });
  });
});

// ---------------------------------------------------------------------------
// Malformed frontmatter
// ---------------------------------------------------------------------------

describe('parseAgentContent — malformed input', () => {
  it('rejects malformed YAML frontmatter', () => {
    const content = `---
name: architect
description: [invalid yaml
---
`;
    const result = parseAgentContent(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid YAML frontmatter');
    }
  });
});
