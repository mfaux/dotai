import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel, getKnownModels, loadModelOverrides } from './model-aliases.ts';
import type { TargetAgent } from './types.ts';
import { TARGET_AGENTS } from './target-agents.ts';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// resolveModel — built-in aliases
// ---------------------------------------------------------------------------

describe('resolveModel — built-in aliases', () => {
  it('resolves claude-sonnet-4 for copilot', () => {
    const result = resolveModel('claude-sonnet-4', 'github-copilot');
    expect(result.model).toBe('claude-sonnet-4');
    expect(result.warning).toBeUndefined();
  });

  it('resolves claude-sonnet-4 for claude-code', () => {
    const result = resolveModel('claude-sonnet-4', 'claude-code');
    expect(result.model).toBe('claude-sonnet-4');
    expect(result.warning).toBeUndefined();
  });

  it('resolves claude-opus-4 for copilot', () => {
    const result = resolveModel('claude-opus-4', 'github-copilot');
    expect(result.model).toBe('claude-opus-4');
    expect(result.warning).toBeUndefined();
  });

  it('resolves claude-haiku-3.5 to agent-specific names', () => {
    const copilot = resolveModel('claude-haiku-3.5', 'github-copilot');
    expect(copilot.model).toBe('claude-3.5-haiku');

    const claude = resolveModel('claude-haiku-3.5', 'claude-code');
    expect(claude.model).toBe('claude-3-5-haiku-latest');
  });

  it('resolves gpt-4o for copilot', () => {
    const result = resolveModel('gpt-4o', 'github-copilot');
    expect(result.model).toBe('gpt-4o');
    expect(result.warning).toBeUndefined();
  });

  it('returns null with warning for gpt-4o on claude-code', () => {
    const result = resolveModel('gpt-4o', 'claude-code');
    expect(result.model).toBeNull();
    expect(result.warning).toContain('gpt-4o');
    expect(result.warning).toContain('not supported');
  });

  it('resolves gemini-2.5-pro for copilot', () => {
    const result = resolveModel('gemini-2.5-pro', 'github-copilot');
    expect(result.model).toBe('gemini-2.5-pro');
  });

  it.each(['cursor', 'windsurf', 'cline'] as TargetAgent[])(
    'returns null with warning for any model on %s (no model selection)',
    (agent) => {
      const result = resolveModel('claude-sonnet-4', agent);
      expect(result.model).toBeNull();
      expect(result.warning).toBeDefined();
    }
  );
});

// ---------------------------------------------------------------------------
// resolveModel — unknown models
// ---------------------------------------------------------------------------

describe('resolveModel — unknown models', () => {
  it('returns null with warning for unknown model', () => {
    const result = resolveModel('totally-unknown-model', 'github-copilot');
    expect(result.model).toBeNull();
    expect(result.warning).toContain('Unknown model');
    expect(result.warning).toContain('totally-unknown-model');
  });

  it('returns null with warning for unknown model on all agents', () => {
    for (const agent of TARGET_AGENTS) {
      const result = resolveModel('nonexistent-model', agent);
      expect(result.model).toBeNull();
      expect(result.warning).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// resolveModel — user overrides
// ---------------------------------------------------------------------------

describe('resolveModel — user overrides', () => {
  it('user override takes precedence over built-in', () => {
    const overrides = {
      'claude-sonnet-4': {
        'github-copilot': 'my-custom-sonnet-id',
      },
    };

    const result = resolveModel('claude-sonnet-4', 'github-copilot', overrides);
    expect(result.model).toBe('my-custom-sonnet-id');
  });

  it('user override can explicitly set to null', () => {
    const overrides = {
      'claude-sonnet-4': {
        'github-copilot': null as unknown as string,
      },
    };

    const result = resolveModel('claude-sonnet-4', 'github-copilot', overrides);
    expect(result.model).toBeNull();
    expect(result.warning).toContain('user overrides');
  });

  it('falls through to built-in when user override has no entry for agent', () => {
    const overrides = {
      'claude-sonnet-4': {
        'claude-code': 'my-custom-claude',
      },
    };

    // Copilot not in overrides — should fall through to built-in
    const result = resolveModel('claude-sonnet-4', 'github-copilot', overrides);
    expect(result.model).toBe('claude-sonnet-4');
  });

  it('falls through to built-in when user override has no entry for model', () => {
    const overrides = {
      'some-other-model': {
        'github-copilot': 'custom-id',
      },
    };

    const result = resolveModel('claude-sonnet-4', 'github-copilot', overrides);
    expect(result.model).toBe('claude-sonnet-4');
  });

  it('user override can define a completely new model', () => {
    const overrides = {
      'my-custom-model': {
        'github-copilot': 'custom-model-for-copilot',
        'claude-code': 'custom-model-for-claude',
      },
    };

    const copilot = resolveModel('my-custom-model', 'github-copilot', overrides);
    expect(copilot.model).toBe('custom-model-for-copilot');

    const claude = resolveModel('my-custom-model', 'claude-code', overrides);
    expect(claude.model).toBe('custom-model-for-claude');
  });

  it('empty overrides object falls through to built-in', () => {
    const result = resolveModel('claude-sonnet-4', 'github-copilot', {});
    expect(result.model).toBe('claude-sonnet-4');
  });
});

// ---------------------------------------------------------------------------
// getKnownModels
// ---------------------------------------------------------------------------

describe('getKnownModels', () => {
  it('returns all built-in model names', () => {
    const models = getKnownModels();
    expect(models).toContain('claude-sonnet-4');
    expect(models).toContain('claude-opus-4');
    expect(models).toContain('claude-haiku-3.5');
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-4.1');
    expect(models).toContain('o3-mini');
    expect(models).toContain('gemini-2.5-pro');
  });

  it('returns an array of strings', () => {
    const models = getKnownModels();
    expect(Array.isArray(models)).toBe(true);
    for (const m of models) {
      expect(typeof m).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// loadModelOverrides
// ---------------------------------------------------------------------------

describe('loadModelOverrides', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dotai-model-overrides-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads overrides from package.json dotai.modelAliases', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'claude-sonnet-4': {
              'github-copilot': 'my-custom-sonnet',
            },
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toEqual({
      'claude-sonnet-4': {
        'github-copilot': 'my-custom-sonnet',
      },
    });
  });

  it('returns undefined when package.json has no dotai field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-project' }));

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('returns undefined when dotai has no modelAliases field', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', dotai: { someOtherField: true } })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('returns undefined when package.json does not exist', async () => {
    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('returns undefined when package.json is invalid JSON', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not valid json {{{');

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('supports null values in overrides', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'claude-sonnet-4': {
              'github-copilot': null,
            },
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toEqual({
      'claude-sonnet-4': {
        'github-copilot': null,
      },
    });
  });

  it('supports multiple model entries', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'claude-sonnet-4': {
              'github-copilot': 'custom-sonnet',
            },
            'my-private-model': {
              'github-copilot': 'private-copilot-id',
              'claude-code': 'private-claude-id',
            },
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toEqual({
      'claude-sonnet-4': {
        'github-copilot': 'custom-sonnet',
      },
      'my-private-model': {
        'github-copilot': 'private-copilot-id',
        'claude-code': 'private-claude-id',
      },
    });
  });

  it('skips invalid agent map entries (non-object values)', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'valid-model': {
              'github-copilot': 'valid-id',
            },
            'invalid-model': 'not-an-object',
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toEqual({
      'valid-model': {
        'github-copilot': 'valid-id',
      },
    });
  });

  it('skips invalid values within agent maps (non-string, non-null)', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'test-model': {
              'github-copilot': 'valid-id',
              'claude-code': 42,
            },
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toEqual({
      'test-model': {
        'github-copilot': 'valid-id',
      },
    });
  });

  it('returns undefined when modelAliases is an array', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: ['not', 'an', 'object'],
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('returns undefined when all entries are invalid', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'model-a': 'not-an-object',
            'model-b': 123,
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    expect(overrides).toBeUndefined();
  });

  it('loaded overrides work with resolveModel', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dotai: {
          modelAliases: {
            'claude-sonnet-4': {
              'github-copilot': 'my-org-sonnet',
            },
          },
        },
      })
    );

    const overrides = await loadModelOverrides(tmpDir);
    const result = resolveModel('claude-sonnet-4', 'github-copilot', overrides);
    expect(result.model).toBe('my-org-sonnet');

    // Falls through to built-in for agents not in overrides
    const claudeResult = resolveModel('claude-sonnet-4', 'claude-code', overrides);
    expect(claudeResult.model).toBe('claude-sonnet-4');
  });
});
