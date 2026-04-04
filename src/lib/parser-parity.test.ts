import { describe, it, expect } from 'vitest';
import { parseListOptions } from '../list/list.ts';
import { parseRemoveOptions } from '../remove/remove.ts';
import { parseSyncOptions } from '../sync/sync.ts';

/**
 * Parser parity tests: verify that shared flags (`--targets`, `--type`) produce
 * consistent results across list, remove, and sync commands.
 *
 * Known intentional differences are documented inline:
 * - list's `--type` uses `parseTypeFlag` and errors on missing/invalid values
 * - remove's `--type` consumes only a single token (positional args follow flags)
 *   and silently accepts `--type` with no value (returns empty array)
 * - sync has no `--type` flag
 */

// ---------------------------------------------------------------------------
// --targets parity (list / remove / sync all use consumeMultiValues)
// ---------------------------------------------------------------------------

describe('--targets parity across commands', () => {
  it('should parse -a with a single agent', () => {
    const list = parseListOptions(['-a', 'cursor']);
    const { options: remove } = parseRemoveOptions(['-a', 'cursor']);
    const { options: sync } = parseSyncOptions(['-a', 'cursor']);

    expect(list.targets).toEqual(['cursor']);
    expect(remove.targets).toEqual(['cursor']);
    expect(sync.targets).toEqual(['cursor']);
  });

  it('should parse --agent with a single agent', () => {
    const list = parseListOptions(['--targets', 'claude-code']);
    const { options: remove } = parseRemoveOptions(['--targets', 'claude-code']);
    const { options: sync } = parseSyncOptions(['--targets', 'claude-code']);

    expect(list.targets).toEqual(['claude-code']);
    expect(remove.targets).toEqual(['claude-code']);
    expect(sync.targets).toEqual(['claude-code']);
  });

  it('should consume multiple space-separated agents', () => {
    const list = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
    const { options: remove } = parseRemoveOptions(['-a', 'claude-code', 'cursor', 'codex']);
    const { options: sync } = parseSyncOptions(['-a', 'claude-code', 'cursor', 'codex']);

    expect(list.targets).toEqual(['claude-code', 'cursor', 'codex']);
    expect(remove.targets).toEqual(['claude-code', 'cursor', 'codex']);
    expect(sync.targets).toEqual(['claude-code', 'cursor', 'codex']);
  });

  it('should stop consuming agents at the next flag', () => {
    const list = parseListOptions(['-a', 'claude-code', '-g']);
    const { options: remove } = parseRemoveOptions(['-a', 'claude-code', '-y']);
    const { options: sync } = parseSyncOptions(['-a', 'claude-code', '-y']);

    expect(list.targets).toEqual(['claude-code']);
    expect(list.global).toBe(true);

    expect(remove.targets).toEqual(['claude-code']);
    expect(remove.yes).toBe(true);

    expect(sync.targets).toEqual(['claude-code']);
    expect(sync.yes).toBe(true);
  });

  it('should return empty agent array for -a with no values', () => {
    const list = parseListOptions(['-a']);
    const { options: remove } = parseRemoveOptions(['-a']);
    const { options: sync } = parseSyncOptions(['-a']);

    expect(list.targets).toEqual([]);
    expect(remove.targets).toEqual([]);
    expect(sync.targets).toEqual([]);
  });

  it('should accumulate agents from repeated --agent flags', () => {
    const list = parseListOptions(['-a', 'cursor', '--targets', 'codex']);
    const { options: remove } = parseRemoveOptions(['-a', 'cursor', '--targets', 'codex']);
    const { options: sync } = parseSyncOptions(['-a', 'cursor', '--targets', 'codex']);

    expect(list.targets).toEqual(['cursor', 'codex']);
    expect(remove.targets).toEqual(['cursor', 'codex']);
    expect(sync.targets).toEqual(['cursor', 'codex']);
  });

  it('should stop at --flag boundaries between groups', () => {
    const list = parseListOptions(['-a', 'cursor', 'codex', '--targets', 'claude-code']);
    const { options: remove } = parseRemoveOptions([
      '-a',
      'cursor',
      'codex',
      '--targets',
      'claude-code',
    ]);
    const { options: sync } = parseSyncOptions([
      '-a',
      'cursor',
      'codex',
      '--targets',
      'claude-code',
    ]);

    expect(list.targets).toEqual(['cursor', 'codex', 'claude-code']);
    expect(remove.targets).toEqual(['cursor', 'codex', 'claude-code']);
    expect(sync.targets).toEqual(['cursor', 'codex', 'claude-code']);
  });
});

// ---------------------------------------------------------------------------
// --type parity (list / remove — sync has no --type)
// ---------------------------------------------------------------------------

describe('--type parity between list and remove', () => {
  it('should parse --type with a single value', () => {
    const list = parseListOptions(['--type', 'instruction']);
    const { options: remove } = parseRemoveOptions(['--type', 'instruction']);

    expect(list.type).toEqual(['instruction']);
    expect(remove.type).toEqual(['instruction']);
  });

  it('should parse -t short flag', () => {
    const list = parseListOptions(['-t', 'skill']);
    const { options: remove } = parseRemoveOptions(['-t', 'skill']);

    expect(list.type).toEqual(['skill']);
    expect(remove.type).toEqual(['skill']);
  });

  it('should parse comma-separated type values', () => {
    const list = parseListOptions(['--type', 'instruction,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'instruction,prompt']);

    expect(list.type).toEqual(['instruction', 'prompt']);
    expect(remove.type).toEqual(['instruction', 'prompt']);
  });

  it('should parse all four types comma-separated', () => {
    const list = parseListOptions(['-t', 'skill,instruction,prompt,agent']);
    const { options: remove } = parseRemoveOptions(['-t', 'skill,instruction,prompt,agent']);

    expect(list.type).toEqual(['skill', 'instruction', 'prompt', 'agent']);
    expect(remove.type).toEqual(['skill', 'instruction', 'prompt', 'agent']);
  });

  it('should normalize to lowercase', () => {
    const list = parseListOptions(['--type', 'INSTRUCTION']);
    const { options: remove } = parseRemoveOptions(['--type', 'INSTRUCTION']);

    expect(list.type).toEqual(['instruction']);
    expect(remove.type).toEqual(['instruction']);
  });

  it('should normalize mixed-case CSV values', () => {
    const list = parseListOptions(['--type', 'Instruction,PROMPT']);
    const { options: remove } = parseRemoveOptions(['--type', 'Instruction,PROMPT']);

    expect(list.type).toEqual(['instruction', 'prompt']);
    expect(remove.type).toEqual(['instruction', 'prompt']);
  });

  it('should deduplicate CSV values', () => {
    const list = parseListOptions(['--type', 'instruction,instruction,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'instruction,instruction,prompt']);

    expect(list.type).toEqual(['instruction', 'prompt']);
    expect(remove.type).toEqual(['instruction', 'prompt']);
  });

  it('should deduplicate across repeated flags', () => {
    const list = parseListOptions(['--type', 'instruction,prompt', '--type', 'instruction']);
    const { options: remove } = parseRemoveOptions([
      '--type',
      'instruction,prompt',
      '--type',
      'instruction',
    ]);

    expect(list.type).toEqual(['instruction', 'prompt']);
    expect(remove.type).toEqual(['instruction', 'prompt']);
  });

  it('should filter empty segments from CSV', () => {
    const list = parseListOptions(['--type', 'instruction,,prompt']);
    const { options: remove } = parseRemoveOptions(['--type', 'instruction,,prompt']);

    expect(list.type).toEqual(['instruction', 'prompt']);
    expect(remove.type).toEqual(['instruction', 'prompt']);
  });

  it('should parse --type alongside --agent', () => {
    const list = parseListOptions(['--type', 'instruction', '-a', 'cursor']);
    const { options: remove } = parseRemoveOptions(['--type', 'instruction', '-a', 'cursor']);

    expect(list.type).toEqual(['instruction']);
    expect(list.targets).toEqual(['cursor']);

    expect(remove.type).toEqual(['instruction']);
    expect(remove.targets).toEqual(['cursor']);
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
    const { skills, options } = parseRemoveOptions(['--type', 'instruction', 'my-skill']);
    expect(options.type).toEqual(['instruction']);
    expect(skills).toEqual(['my-skill']);
  });

  it('list: --type consumes multiple space-separated values (greedy)', () => {
    // list has no positional args, so --type can safely consume multiple values
    const options = parseListOptions(['--type', 'instruction', 'prompt']);
    expect(options.type).toEqual(['instruction', 'prompt']);
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
    expect(options.targets).toEqual(['cursor']);
  });

  it('should parse -a with multiple agents', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', 'codex', 'claude-code']);
    expect(options.targets).toEqual(['cursor', 'codex', 'claude-code']);
  });

  it('should stop consuming agents at next flag', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', '-y']);
    expect(options.targets).toEqual(['cursor']);
    expect(options.yes).toBe(true);
  });

  it('should combine all flags', () => {
    const { options } = parseSyncOptions(['-y', '-f', '-a', 'cursor', 'codex']);
    expect(options.yes).toBe(true);
    expect(options.force).toBe(true);
    expect(options.targets).toEqual(['cursor', 'codex']);
  });

  it('should accumulate agents from repeated -a flags', () => {
    const { options } = parseSyncOptions(['-a', 'cursor', '-a', 'codex']);
    expect(options.targets).toEqual(['cursor', 'codex']);
  });

  it('should ignore unknown flags', () => {
    const { options } = parseSyncOptions(['--unknown', 'value']);
    expect(options).toEqual({});
  });

  it('should handle -a with no following values', () => {
    const { options } = parseSyncOptions(['-a']);
    expect(options.targets).toEqual([]);
  });
});
