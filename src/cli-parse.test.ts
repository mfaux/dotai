import { describe, it, expect } from 'vitest';
import { consumeMultiValues, parseTypeFlag, VALID_CONTEXT_TYPES } from './cli-parse.ts';

describe('consumeMultiValues', () => {
  it('should consume a single value', () => {
    const { values, nextIndex } = consumeMultiValues(['foo'], 0);
    expect(values).toEqual(['foo']);
    expect(nextIndex).toBe(1);
  });

  it('should consume multiple consecutive values', () => {
    const { values, nextIndex } = consumeMultiValues(['foo', 'bar', 'baz'], 0);
    expect(values).toEqual(['foo', 'bar', 'baz']);
    expect(nextIndex).toBe(3);
  });

  it('should stop at a flag starting with --', () => {
    const { values, nextIndex } = consumeMultiValues(['foo', 'bar', '--flag'], 0);
    expect(values).toEqual(['foo', 'bar']);
    expect(nextIndex).toBe(2);
  });

  it('should stop at a flag starting with -', () => {
    const { values, nextIndex } = consumeMultiValues(['val', '-f'], 0);
    expect(values).toEqual(['val']);
    expect(nextIndex).toBe(1);
  });

  it('should return empty for flag at start', () => {
    const { values, nextIndex } = consumeMultiValues(['--flag'], 0);
    expect(values).toEqual([]);
    expect(nextIndex).toBe(0);
  });

  it('should return empty for out-of-bounds start', () => {
    const { values, nextIndex } = consumeMultiValues(['a', 'b'], 5);
    expect(values).toEqual([]);
    expect(nextIndex).toBe(5);
  });

  it('should return empty for empty array', () => {
    const { values, nextIndex } = consumeMultiValues([], 0);
    expect(values).toEqual([]);
    expect(nextIndex).toBe(0);
  });

  it('should respect non-zero start index', () => {
    const { values, nextIndex } = consumeMultiValues(['skip', 'foo', 'bar'], 1);
    expect(values).toEqual(['foo', 'bar']);
    expect(nextIndex).toBe(3);
  });

  describe('splitCommas', () => {
    it('should split comma-separated values', () => {
      const { values, nextIndex } = consumeMultiValues(['a,b,c'], 0, { splitCommas: true });
      expect(values).toEqual(['a', 'b', 'c']);
      expect(nextIndex).toBe(1);
    });

    it('should trim whitespace around comma-separated values', () => {
      const { values } = consumeMultiValues(['a , b , c'], 0, { splitCommas: true });
      expect(values).toEqual(['a', 'b', 'c']);
    });

    it('should filter out empty segments from commas', () => {
      const { values } = consumeMultiValues([',,,'], 0, { splitCommas: true });
      expect(values).toEqual([]);
    });

    it('should filter out empty segments between values', () => {
      const { values } = consumeMultiValues(['a,,b'], 0, { splitCommas: true });
      expect(values).toEqual(['a', 'b']);
    });

    it('should combine CSV and multi-arg consumption', () => {
      const { values, nextIndex } = consumeMultiValues(['a,b', 'c', '--flag'], 0, {
        splitCommas: true,
      });
      expect(values).toEqual(['a', 'b', 'c']);
      expect(nextIndex).toBe(2);
    });

    it('should not split commas when splitCommas is not set', () => {
      const { values } = consumeMultiValues(['a,b,c'], 0);
      expect(values).toEqual(['a,b,c']);
    });
  });
});

describe('VALID_CONTEXT_TYPES', () => {
  it('should contain all four context types', () => {
    expect(VALID_CONTEXT_TYPES).toEqual(['skill', 'rule', 'prompt', 'agent']);
  });
});

describe('parseTypeFlag', () => {
  const throwError = (message: string): never => {
    throw new Error(message);
  };

  it('should parse a single type value', () => {
    const { types, nextIndex } = parseTypeFlag([], ['rule'], 0, throwError);
    expect(types).toEqual(['rule']);
    expect(nextIndex).toBe(1);
  });

  it('should parse comma-separated type values', () => {
    const { types } = parseTypeFlag([], ['rule,prompt'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt']);
  });

  it('should parse space-separated type values', () => {
    const { types, nextIndex } = parseTypeFlag([], ['rule', 'prompt', '--flag'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt']);
    expect(nextIndex).toBe(2);
  });

  it('should normalize to lowercase', () => {
    const { types } = parseTypeFlag([], ['RULE'], 0, throwError);
    expect(types).toEqual(['rule']);
  });

  it('should normalize mixed-case comma-separated values', () => {
    const { types } = parseTypeFlag([], ['Rule,PROMPT,Agent'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt', 'agent']);
  });

  it('should deduplicate values', () => {
    const { types } = parseTypeFlag([], ['rule,rule,prompt'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt']);
  });

  it('should merge with existing values and deduplicate', () => {
    const { types } = parseTypeFlag(['rule'], ['prompt,rule'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt']);
  });

  it('should filter empty segments from CSV', () => {
    const { types } = parseTypeFlag([], ['rule,,prompt'], 0, throwError);
    expect(types).toEqual(['rule', 'prompt']);
  });

  it('should accept all four valid types', () => {
    const { types } = parseTypeFlag([], ['skill,rule,prompt,agent'], 0, throwError);
    expect(types).toEqual(['skill', 'rule', 'prompt', 'agent']);
  });

  it('should throw on invalid type value', () => {
    expect(() => parseTypeFlag([], ['invalid'], 0, throwError)).toThrow('Invalid type: invalid');
  });

  it('should throw on missing value', () => {
    expect(() => parseTypeFlag([], ['--flag'], 0, throwError)).toThrow('--type requires a value');
  });

  it('should throw on empty args', () => {
    expect(() => parseTypeFlag([], [], 0, throwError)).toThrow('--type requires a value');
  });

  it('should throw when only commas are provided', () => {
    expect(() => parseTypeFlag([], [',,,'], 0, throwError)).toThrow('--type requires a value');
  });

  it('should include valid types message in error for invalid type', () => {
    expect(() => parseTypeFlag([], ['bad'], 0, throwError)).toThrow(
      'Valid types: skill, rule, prompt, agent'
    );
  });

  it('should include valid types message in error for missing value', () => {
    expect(() => parseTypeFlag([], [], 0, throwError)).toThrow(
      'Valid types: skill, rule, prompt, agent'
    );
  });
});
