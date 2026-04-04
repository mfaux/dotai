import { describe, it, expect } from 'vitest';
import { extractOverrides, mergeOverrides } from './override-parser.ts';
import type { CanonicalPrompt, TargetAgent } from '../types.ts';

// ---------------------------------------------------------------------------
// extractOverrides
// ---------------------------------------------------------------------------

describe('extractOverrides', () => {
  const baseFields = new Set(['name', 'description', 'value']);

  const fieldExtractor = (agentData: Record<string, unknown>) => {
    const fields: Record<string, unknown> = {};
    if ('value' in agentData) {
      if (typeof agentData.value !== 'string') {
        return { fields, error: 'value must be a string' };
      }
      fields.value = agentData.value;
    }
    return { fields, error: null };
  };

  it('returns undefined overrides when no agent keys present', () => {
    const data = { name: 'test', description: 'desc', value: 'x' };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('extracts override for a known target agent', () => {
    const data = {
      name: 'test',
      description: 'desc',
      'github-copilot': { value: 'overridden' },
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeDefined();
    expect(result.overrides!['github-copilot']).toEqual({ value: 'overridden' });
    expect(result.warnings).toEqual([]);
  });

  it('warns on unknown key', () => {
    const data = {
      name: 'test',
      description: 'desc',
      'unknown-agent': { value: 'x' },
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('unknown-agent');
  });

  it('skips null/undefined agent blocks', () => {
    const data = {
      name: 'test',
      description: 'desc',
      cursor: null,
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('warns on non-object agent blocks', () => {
    const data = {
      name: 'test',
      description: 'desc',
      cursor: 'not-an-object',
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cursor');
    expect(result.warnings[0]).toContain('object');
  });

  it('warns on array agent blocks', () => {
    const data = {
      name: 'test',
      description: 'desc',
      cursor: ['not', 'an', 'object'],
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cursor');
  });

  it('reports validation errors from fieldExtractor as warnings', () => {
    const data = {
      name: 'test',
      description: 'desc',
      'github-copilot': { value: 42 }, // not a string
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('github-copilot');
    expect(result.warnings[0]).toContain('value must be a string');
  });

  it('extracts multiple agent overrides', () => {
    const data = {
      name: 'test',
      cursor: { value: 'a' },
      'github-copilot': { value: 'b' },
    };
    const result = extractOverrides(data, baseFields, fieldExtractor);

    expect(result.overrides).toBeDefined();
    expect(result.overrides!['cursor']).toEqual({ value: 'a' });
    expect(result.overrides!['github-copilot']).toEqual({ value: 'b' });
  });
});

// ---------------------------------------------------------------------------
// mergeOverrides
// ---------------------------------------------------------------------------

describe('mergeOverrides', () => {
  function makePrompt(
    overrides?: Partial<Record<TargetAgent, Partial<CanonicalPrompt>>>
  ): CanonicalPrompt {
    return {
      name: 'review-code',
      description: 'Base description',
      tools: ['search'],
      schemaVersion: 1,
      body: 'Body text',
      overrides,
    };
  }

  it('returns base fields unchanged when no overrides exist', () => {
    const prompt = makePrompt();
    const merged = mergeOverrides(prompt, 'github-copilot');

    expect(merged).toEqual({
      name: 'review-code',
      description: 'Base description',
      tools: ['search'],
      schemaVersion: 1,
      body: 'Body text',
    });
    expect('overrides' in merged).toBe(false);
  });

  it('returns base fields when target agent has no override', () => {
    const prompt = makePrompt({
      cursor: { description: 'Cursor-specific' },
    });
    const merged = mergeOverrides(prompt, 'github-copilot');

    expect(merged.description).toBe('Base description');
    expect('overrides' in merged).toBe(false);
  });

  it('merges override fields for matching target agent', () => {
    const prompt = makePrompt({
      'github-copilot': { description: 'Copilot-specific' },
    });
    const merged = mergeOverrides(prompt, 'github-copilot');

    expect(merged.description).toBe('Copilot-specific');
    expect(merged.name).toBe('review-code');
    expect('overrides' in merged).toBe(false);
  });

  it('merges multiple override fields', () => {
    const prompt = makePrompt({
      'claude-code': { agent: 'plan', description: 'Claude-specific' },
    });
    const merged = mergeOverrides(prompt, 'claude-code');

    expect(merged.agent).toBe('plan');
    expect(merged.description).toBe('Claude-specific');
    expect(merged.tools).toEqual(['search']);
  });

  it('strips overrides field from result', () => {
    const prompt = makePrompt({
      'github-copilot': { description: 'Copilot-specific' },
    });
    const merged = mergeOverrides(prompt, 'github-copilot');

    expect('overrides' in merged).toBe(false);
  });
});
