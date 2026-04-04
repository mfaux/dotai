import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runCli } from '../src/lib/test-utils.ts';
import { createTempProjectDir } from './e2e-utils.ts';

// ---------------------------------------------------------------------------
// CLI skill subprocess tests
// ---------------------------------------------------------------------------

describe('CLI skill subprocess tests', () => {
  let tempDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, projectDir, cleanup } = await createTempProjectDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('add --dry-run does not install skills or write local lock files', async () => {
    const sourceRepo = join(tempDir, 'skill-source-repo');
    await mkdir(sourceRepo, { recursive: true });
    await writeFile(
      join(sourceRepo, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    const result = runCli(
      ['add', sourceRepo, '--dry-run', '-y', '--targets', 'claude-code'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry run');
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(join(projectDir, '.agents'))).toBe(false);
    expect(existsSync(join(projectDir, 'skills-lock.json'))).toBe(false);
  });
});
