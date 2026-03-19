import { describe, it, expect } from 'vitest';
import { parseListOptions } from './list.ts';
import { parseRemoveOptions } from './remove.ts';
import { parseSyncOptions } from './sync.ts';

/**
 * Parser parity tests: verify that shared flags (`--agents`, `--type`) produce
 * consistent results across list, remove, and sync commands.
 *
 * Known intentional differences are documented inline:
 * - list's `--type` uses `parseTypeFlag` and errors on missing/invalid values
 * - remove's `--type` consumes only a single token (positional args follow flags)
 *   and silently accepts `--type` with no value (returns empty array)
 * - sync has no `--type` flag
 */

// ---------------------------------------------------------------------------
// --agents parity (list / remove / sync all use consumeMultiValues)
// ---------------------------------------------------------------------------

describe('--agents parity across commands', () => {
  it('should parse -a with a single agent', () => {
    const list = parseListOptions(['-a', 'cursor']);
    const { options: remove } = parseRemoveOptions(['-a', 'cursor']);
    const { options: sync } = parseSyncOptions(['-a', 'cursor']);

    expect(list.agents).toEqual(['cursor']);
    expect(remove.agents).toEqual(['cursor']);
    expect(sync.agents).toEqual(['cursor']);
  });

  it('should parse --agent with a single agent', () => {
    const list = parseListOptions(['--agents', 'claude-code']);
    const { options: remove } = parseRemoveOptions(['--agents', 'claude-code']);
    const { options: sync } = parseSyncOptions(['--agents', 'claude-code']);

    expect(list.agents).toEqual(['claude-code']);
    expect(remove.agents).toEqual(['claude-code']);
    expect(sync.agents).toEqual(['claude-code']);
  });

  it('should consume multiple space-separated agents', () => {
    const list = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
    const { options: remove } = parseRemoveOptions(['-a', 'claude-code', 'cursor', 'codex']);
    const { options: sync } = parseSyncOptions(['-a', 'claude-code', 'cursor', 'codex']);

    expect(list.agents).toEqual(['claude-code', 'cursor', 'codex']);
    expect(remove.agents).toEqual(['claude-code', 'cursor', 'codex']);
    expect(sync.agents).toEqual(['claude-code', 'cursor', 'codex']);
  });

  it('should stop consuming agents at the next flag', () => {
    const list = parseListOptions(['-a', 'claude-code', '-g']);
    const { options: remove } = parseRemoveOptions(['-a', 'claude-code', '-y']);
    const { options: sync } = parseSyncOptions(['-a', 'claude-code', '-y']);

    expect(list.agents).toEqual(['claude-code']);
    expect(list.global).toBe(true);

    expect(remove.agents).toEqual(['claude-code']);
    expect(remove.yes).toBe(true);

    expect(sync.agents).toEqual(['claude-code']);
    expect(sync.yes).toBe(true);
  });

  it('should return empty agent array for -a with no values', () => {
    const list = parseListOptions(['-a']);
    const { options: remove } = parseRemoveOptions(['-a']);
    const { options: sync } = parseSyncOptions(['-a']);

    expect(list.agents).toEqual([]);
    expect(remove.agents).toEqual([]);
    expect(sync.agents).toEqual([]);
  });

  it('should accumulate agents from repeated --agent flags', () => {
    const list = parseListOptions(['-a', 'cursor', '--agents', 'codex']);
    const { options: remove } = parseRemoveOptions(['-a', 'cursor', '--agents', 'codex']);
    const { options: sync } = parseSyncOptions(['-a', 'cursor', '--agents', 'codex']);

    expect(list.agents).toEqual(['cursor', 'codex']);
    expect(remove.agents).toEqual(['cursor', 'codex']);
    expect(sync.agents).toEqual(['cursor', 'codex']);
  });

  it('should stop at --flag boundaries between groups', () => {
    const list = parseListOptions(['-a', 'cursor', 'codex', '--agents', 'claude-code']);
    const { options: remove } = parseRemoveOptions([
      '-a',
      'cursor',
      'codex',
      '--agents',
      'claude-code',
    ]);
    const { options: sync } = parseSyncOptions([
      '-a',
      'cursor',
      'codex',
      '--agents',
      'claude-code',
    ]);

    expect(list.agents).toEqual(['cursor', 'codex', 'claude-code']);
    expect(remove.agents).toEqual(['cursor', 'codex', 'claude-code']);
    expect(sync.agents).toEqual(['cursor', 'codex', 'claude-code']);
  });
});

// ---------------------------------------------------------------------------
// --type parity (list / remove — sync has no --type)
// ---------------------------------------------------------------------------

describe('--type parity between list and remove', () => {
  it('should parse --type with a single value', () => {
    const list = parseListOptions(['--type', 'rule']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule']);

    expect(list.type).toEqual(['rule']);
    expect(remove.type).toEqual(['rule']);
  });

  it('should parse -t short flag', () => {
    const list = parseListOptions(['-t', 'skill']);
    const { options: remove } = parseRemoveOptions(['-t', 'skill']);

    expect(list.type).toEqual(['skill']);
    expect(remove.type).toEqual(['skill']);
  });

  it('should parse comma-separated type values', () => {
    const list = parseListOptions(['--type', 'rule,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule,prompt']);

    expect(list.type).toEqual(['rule', 'prompt']);
    expect(remove.type).toEqual(['rule', 'prompt']);
  });

  it('should parse all four types comma-separated', () => {
    const list = parseListOptions(['-t', 'skill,rule,prompt,agent']);
    const { options: remove } = parseRemoveOptions(['-t', 'skill,rule,prompt,agent']);

    expect(list.type).toEqual(['skill', 'rule', 'prompt', 'agent']);
    expect(remove.type).toEqual(['skill', 'rule', 'prompt', 'agent']);
  });

  it('should normalize to lowercase', () => {
    const list = parseListOptions(['--type', 'RULE']);
    const { options: remove } = parseRemoveOptions(['--type', 'RULE']);

    expect(list.type).toEqual(['rule']);
    expect(remove.type).toEqual(['rule']);
  });

  it('should normalize mixed-case CSV values', () => {
    const list = parseListOptions(['--type', 'Rule,PROMPT']);
    const { options: remove } = parseRemoveOptions(['--type', 'Rule,PROMPT']);

    expect(list.type).toEqual(['rule', 'prompt']);
    expect(remove.type).toEqual(['rule', 'prompt']);
  });

  it('should deduplicate CSV values', () => {
    const list = parseListOptions(['--type', 'rule,rule,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule,rule,prompt']);

    expect(list.type).toEqual(['rule', 'prompt']);
    expect(remove.type).toEqual(['rule', 'prompt']);
  });

  it('should deduplicate across repeated flags', () => {
    const list = parseListOptions(['--type', 'rule,prompt', '--type', 'rule']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule,prompt', '--type', 'rule']);

    expect(list.type).toEqual(['rule', 'prompt']);
    expect(remove.type).toEqual(['rule', 'prompt']);
  });

  it('should filter empty segments from CSV', () => {
    const list = parseListOptions(['--type', 'rule,,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule,,prompt']);

    expect(list.type).toEqual(['rule', 'prompt']);
    expect(remove.type).toEqual(['rule', 'prompt']);
  });

  it('should parse --type alongside --agent', () => {
    const list = parseListOptions(['--type', 'rule', '-a', 'cursor']);
    const { options: remove } = parseRemoveOptions(['--type', 'rule', '-a', 'cursor']);

    expect(list.type).toEqual(['rule']);
    expect(list.agents).toEqual(['cursor']);

    expect(remove.type).toEqual(['rule']);
    expect(remove.agents).toEqual(['cursor']);
  });
});

// ---------------------------------------------------------------------------
// Intentional behavioral differences in --type
// ---------------------------------------------------------------------------

describe('--type intentional differences', () => {
  it('remove: --type with no value returns empty array (does not error)', () => {
    // remove silently accepts --type with no value — this is intentional because
    // positional skill names may follow
    const { options } = parseRemoveOptions(['--type']);
    expect(options.type).toEqual([]);
  });

  it('remove: --type followed by flag returns empty array', () => {
    const { options } = parseRemoveOptions(['-t', '-g']);
    expect(options.type).toEqual([]);
    expect(options.global).toBe(true);
  });

  it('remove: --type consumes only one token (not greedy)', () => {
    // remove's --type consumes a single token; subsequent non-flag args are
    // treated as positional skill names
    const { skills, options } = parseRemoveOptions(['--type', 'rule', 'my-skill']);
    expect(options.type).toEqual(['rule']);
    expect(skills).toEqual(['my-skill']);
  });

  it('list: --type consumes multiple space-separated values (greedy)', () => {
    // list has no positional args, so --type can safely consume multiple values
    const options = parseListOptions(['--type', 'rule', 'prompt']);
    expect(options.type).toEqual(['rule', 'prompt']);
  });
});

// ---------------------------------------------------------------------------
// parseSyncOptions coverage (previously untested)
// ---------------------------------------------------------------------------

describe('parseSyncOptions', () => {
  it('should parse empty args', () => {
    const { options } = parseSyncOptions([]);
    expect(options).toEqual({});
  });

  it('should parse -y flag', () => {
    const { options } = parseSyncOptions(['-y']);
    expect(options.yes).toBe(true);
  });

  it('should parse --yes flag', () => {
    const { options } = parseSyncOptions(['--yes']);
    expect(options.yes).toBe(true);
  });

  it('should parse -f flag', () => {
    const { options } = parseSyncOptions(['-f']);
    expect(options.force).toBe(true);
  });

  it('should parse --force flag', () => {
    const { options } = parseSyncOptions(['--force']);
    expect(options.force).toBe(true);
  });

  it('should parse -a with single agent', () => {
    const { options } = parseSyncOptions(['-a', 'cursor']);
    expect(options.agents).toEqual(['cursor']);
  });

  it('should parse -a with multiple agents', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', 'codex', 'claude-code']);
    expect(options.agents).toEqual(['cursor', 'codex', 'claude-code']);
  });

  it('should stop consuming agents at next flag', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', '-y']);
    expect(options.agents).toEqual(['cursor']);
    expect(options.yes).toBe(true);
  });

  it('should combine all flags', () => {
    const { options } = parseSyncOptions(['-y', '-f', '-a', 'cursor', 'codex']);
    expect(options.yes).toBe(true);
    expect(options.force).toBe(true);
    expect(options.agents).toEqual(['cursor', 'codex']);
  });

  it('should accumulate agents from repeated -a flags', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', '-a', 'codex']);
    expect(options.agents).toEqual(['cursor', 'codex']);
  });

  it('should ignore unknown flags', () => {
    const { options } = parseSyncOptions(['--unknown', 'value']);
    expect(options).toEqual({});
  });

  it('should handle -a with no following values', () => {
    const { options } = parseSyncOptions(['-a']);
    expect(options.agents).toEqual([]);
  });
});
