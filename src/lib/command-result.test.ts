import { describe, it, expect } from 'vitest';
import { CommandError } from './command-result.ts';

describe('CommandError', () => {
  it('should store exitCode and message', () => {
    const err = new CommandError(1, 'something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe('something went wrong');
    expect(err.name).toBe('CommandError');
  });

  it('should default message to empty string', () => {
    const err = new CommandError(0);
    expect(err.exitCode).toBe(0);
    expect(err.message).toBe('');
  });

  it('should support exit code 0 for graceful early exit', () => {
    const err = new CommandError(0, 'cancelled');
    expect(err.exitCode).toBe(0);
    expect(err.message).toBe('cancelled');
  });
});
