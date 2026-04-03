import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { discover, filterByType } from './rule-discovery.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index into an array with a length assertion, avoiding TS "Object is possibly undefined" errors. */
function at<T>(arr: T[], index: number): T {
  expect(arr.length).toBeGreaterThan(index);
  return arr[index]!;
}

function instructionmd(frontmatter: Record<string, unknown>, body = ''): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const VALID_INSTRUCTION = {
  name: 'project-guidelines',
  description: 'Project-wide coding guidelines',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('instruction discovery', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dotai-instruction-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Root INSTRUCTIONS.md discovery
  // -------------------------------------------------------------------------

  it('discovers root INSTRUCTIONS.md', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION, 'Follow these guidelines.')
    );

    const result = await discover(testDir);
    const instructions = filterByType(result.items, 'instruction');
    expect(instructions).toHaveLength(1);
    expect(at(instructions, 0).name).toBe('project-guidelines');
    expect(at(instructions, 0).format).toBe('canonical');
    expect(at(instructions, 0).type).toBe('instruction');
    expect(at(instructions, 0).description).toBe('Project-wide coding guidelines');
  });

  it('preserves rawContent for discovered instructions', async () => {
    const content = instructionmd(VALID_INSTRUCTION, 'Body content here.');
    await writeFile(join(testDir, 'INSTRUCTIONS.md'), content);

    const result = await discover(testDir);
    const instructions = filterByType(result.items, 'instruction');
    expect(instructions).toHaveLength(1);
    expect(at(instructions, 0).rawContent).toBe(content);
  });

  // -------------------------------------------------------------------------
  // Subdirectory INSTRUCTIONS.md is ignored
  // -------------------------------------------------------------------------

  it('ignores INSTRUCTIONS.md in subdirectories', async () => {
    await mkdir(join(testDir, 'instructions', 'sub'), { recursive: true });
    await writeFile(
      join(testDir, 'instructions', 'sub', 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION)
    );

    const result = await discover(testDir);
    const instructions = filterByType(result.items, 'instruction');
    expect(instructions).toHaveLength(0);
  });

  it('discovers root but not subdirectory INSTRUCTIONS.md', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION, 'Root instruction')
    );
    await mkdir(join(testDir, 'instructions', 'extra'), { recursive: true });
    await writeFile(
      join(testDir, 'instructions', 'extra', 'INSTRUCTIONS.md'),
      instructionmd({ name: 'extra', description: 'Extra instruction' }, 'Extra body')
    );

    const result = await discover(testDir);
    const instructions = filterByType(result.items, 'instruction');
    expect(instructions).toHaveLength(1);
    expect(at(instructions, 0).name).toBe('project-guidelines');
  });

  // -------------------------------------------------------------------------
  // File size limit enforced
  // -------------------------------------------------------------------------

  it('warns on files exceeding maxFileSize', async () => {
    const bigContent = instructionmd(VALID_INSTRUCTION, 'x'.repeat(200));
    await writeFile(join(testDir, 'INSTRUCTIONS.md'), bigContent);

    const result = await discover(testDir, { maxFileSize: 50 });
    expect(filterByType(result.items, 'instruction')).toHaveLength(0);
    expect(result.warnings.some((w) => w.type === 'file-too-large')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Missing file handled gracefully
  // -------------------------------------------------------------------------

  it('returns empty results when INSTRUCTIONS.md does not exist', async () => {
    const result = await discover(testDir);
    const instructions = filterByType(result.items, 'instruction');
    expect(instructions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Parse error handling
  // -------------------------------------------------------------------------

  it('warns on invalid frontmatter', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd({ name: 123, description: 'test' })
    );

    const result = await discover(testDir);
    expect(filterByType(result.items, 'instruction')).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(at(result.warnings, 0).type).toBe('parse-error');
  });

  it('warns on missing required fields', async () => {
    await writeFile(join(testDir, 'INSTRUCTIONS.md'), '---\nname: test\n---\n\nNo description');

    const result = await discover(testDir);
    expect(filterByType(result.items, 'instruction')).toHaveLength(0);
    expect(result.warnings.some((w) => w.type === 'parse-error')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Type filter
  // -------------------------------------------------------------------------

  it('discovers only instructions when types is ["instruction"]', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION, 'Instructions body')
    );
    // Add other content types to verify they are excluded
    await writeFile(
      join(testDir, 'RULES.md'),
      '---\nname: test-rule\ndescription: A rule\nactivation: auto\n---\n\nRule body'
    );

    const result = await discover(testDir, { types: ['instruction'] });
    expect(filterByType(result.items, 'instruction')).toHaveLength(1);
    expect(filterByType(result.items, 'rule')).toHaveLength(0);
  });

  it('excludes instructions when type filter does not include instruction', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION, 'Instructions body')
    );

    const result = await discover(testDir, { types: ['rule'] });
    expect(filterByType(result.items, 'instruction')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Mixed discovery
  // -------------------------------------------------------------------------

  it('discovers instructions alongside other content types', async () => {
    await writeFile(
      join(testDir, 'INSTRUCTIONS.md'),
      instructionmd(VALID_INSTRUCTION, 'Instructions body')
    );
    await writeFile(
      join(testDir, 'RULES.md'),
      '---\nname: test-rule\ndescription: A rule\nactivation: auto\n---\n\nRule body'
    );
    await writeFile(
      join(testDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A skill\n---\n\nSkill body'
    );

    const result = await discover(testDir);
    expect(filterByType(result.items, 'instruction')).toHaveLength(1);
    expect(filterByType(result.items, 'rule')).toHaveLength(1);
    expect(filterByType(result.items, 'skill')).toHaveLength(1);
  });
});
