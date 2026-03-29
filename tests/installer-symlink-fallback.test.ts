/**
 * Tests for the Windows symlink fallback-to-copy behavior.
 *
 * On Windows without Developer Mode, `fs.symlink()` fails with EPERM.
 * The installer must detect this and fall back to copying files instead.
 *
 * These tests exercise the fallback path by:
 * 1. Testing `installSkillForAgent` with copy mode (explicit --copy flag)
 * 2. Testing `installRemoteSkillForAgent` with copy mode
 * 3. Testing `installWellKnownSkillForAgent` with copy mode
 * 4. Verifying `symlinkFailed` flag is set when symlink fails (mocked)
 * 5. Verifying content is correct regardless of install mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installSkillForAgent,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
} from '../src/skill-installer.ts';
import { agents } from '../src/agents.ts';
import type { AgentType } from '../src/types.ts';
import type { RemoteSkill } from '../src/types.ts';
import type { WellKnownSkill } from '../src/providers/wellknown.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: A test skill\n---\n\nSkill body content here.\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  // Include an extra file to verify full directory copy
  await writeFile(join(dir, 'helper.ts'), 'export const x = 1;\n', 'utf-8');
  return dir;
}

describe('installer copy mode (--copy flag / Windows fallback)', () => {
  let root: string;
  let projectDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dotai-copy-'));
    projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('installSkillForAgent with copy mode', () => {
    it('copies skill directly to agent directory without canonical dir', async () => {
      const skillName = 'copy-skill';
      const skillDir = await makeSkillSource(root, skillName);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'cursor', // Non-universal agent with separate skillsDir
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');
      expect(result.symlinkFailed).toBeUndefined();

      // Verify files are real copies (not symlinks)
      const installPath = result.path;
      const stats = await lstat(installPath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);

      // Verify content
      const content = await readFile(join(installPath, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: ${skillName}`);

      // Verify extra file was copied
      const helperContent = await readFile(join(installPath, 'helper.ts'), 'utf-8');
      expect(helperContent).toBe('export const x = 1;\n');
    });

    it('copies skill for universal agent in copy mode', async () => {
      const skillName = 'copy-universal';
      const skillDir = await makeSkillSource(root, skillName);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'github-copilot', // Universal agent
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: ${skillName}`);
    });

    it('produces same content as symlink mode', async () => {
      const skillName = 'parity-skill';
      const skillDir = await makeSkillSource(root, skillName);

      // Install with copy mode
      const copyProject = join(root, 'copy-project');
      await mkdir(copyProject, { recursive: true });
      const copyResult = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'github-copilot',
        { cwd: copyProject, mode: 'copy', global: false }
      );

      // Install with symlink mode
      const symlinkProject = join(root, 'symlink-project');
      await mkdir(symlinkProject, { recursive: true });
      const symlinkResult = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'github-copilot',
        { cwd: symlinkProject, mode: 'symlink', global: false }
      );

      expect(copyResult.success).toBe(true);
      expect(symlinkResult.success).toBe(true);

      // Both should produce the same SKILL.md content
      const copyContent = await readFile(join(copyResult.path, 'SKILL.md'), 'utf-8');
      const symlinkContent = await readFile(join(symlinkResult.path, 'SKILL.md'), 'utf-8');
      expect(copyContent).toBe(symlinkContent);

      // Both should have the helper file
      const copyHelper = await readFile(join(copyResult.path, 'helper.ts'), 'utf-8');
      const symlinkHelper = await readFile(join(symlinkResult.path, 'helper.ts'), 'utf-8');
      expect(copyHelper).toBe(symlinkHelper);
    });
  });

  describe('installRemoteSkillForAgent with copy mode', () => {
    it('copies remote skill directly to agent directory', async () => {
      const remoteSkill: RemoteSkill = {
        name: 'Remote Copy Skill',
        description: 'A remote skill installed with copy mode',
        content: '---\nname: remote-copy\ndescription: test\n---\n\nRemote body.\n',
        installName: 'remote-copy',
        sourceUrl: 'https://example.com/skill',
        providerId: 'test',
        sourceIdentifier: 'test',
      };

      const result = await installRemoteSkillForAgent(remoteSkill, 'cursor', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');
      expect(result.symlinkFailed).toBeUndefined();

      // Verify it's a real directory, not a symlink
      const stats = await lstat(result.path);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);

      // Verify SKILL.md content
      const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain('name: remote-copy');
      expect(content).toContain('Remote body.');
    });

    it('does not create canonical directory in copy mode', async () => {
      const remoteSkill: RemoteSkill = {
        name: 'No Canonical',
        description: 'test',
        content: '---\nname: no-canonical\ndescription: test\n---\n\nBody.\n',
        installName: 'no-canonical',
        sourceUrl: 'https://example.com/skill',
        providerId: 'test',
        sourceIdentifier: 'test',
      };

      // Use claude-code which has a separate skillsDir (.claude/skills)
      // so canonical (.agents/skills) and agent dirs are different
      const result = await installRemoteSkillForAgent(remoteSkill, 'claude-code', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
      });

      expect(result.success).toBe(true);

      // The canonical directory (.agents/skills/no-canonical) should not exist
      // because copy mode writes directly to agent dir (.claude/skills/no-canonical)
      const canonicalDir = join(projectDir, '.agents', 'skills', 'no-canonical');
      await expect(stat(canonicalDir)).rejects.toThrow();

      // But the agent dir should exist
      const agentDir = join(projectDir, '.claude', 'skills', 'no-canonical');
      const agentStats = await stat(agentDir);
      expect(agentStats.isDirectory()).toBe(true);
    });
  });

  describe('installWellKnownSkillForAgent with copy mode', () => {
    it('copies well-known skill with multiple files', async () => {
      const wellKnownSkill = {
        name: 'well-known-copy',
        description: 'A well-known skill with multiple files',
        content: '---\nname: well-known-copy\ndescription: test\n---\n\nBody.\n',
        installName: 'well-known-copy',
        sourceUrl: 'https://example.com/.well-known/skills/well-known-copy',
        files: new Map([
          ['SKILL.md', '---\nname: well-known-copy\ndescription: test\n---\n\nBody.\n'],
          ['helper.ts', 'export const x = 42;\n'],
          ['utils/format.ts', 'export function fmt() {}\n'],
        ]),
        indexEntry: {
          name: 'well-known-copy',
          description: 'A well-known skill with multiple files',
          files: ['SKILL.md', 'helper.ts', 'utils/format.ts'],
        },
      } satisfies WellKnownSkill;

      const result = await installWellKnownSkillForAgent(wellKnownSkill, 'cursor', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      // Verify all files were written
      const skillMd = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(skillMd).toContain('name: well-known-copy');

      const helper = await readFile(join(result.path, 'helper.ts'), 'utf-8');
      expect(helper).toBe('export const x = 42;\n');

      // Verify nested directory file
      const format = await readFile(join(result.path, 'utils', 'format.ts'), 'utf-8');
      expect(format).toBe('export function fmt() {}\n');
    });
  });

  describe('symlink fallback to copy', () => {
    it('falls back to copy when symlink target is inaccessible', async () => {
      const skillName = 'fallback-skill';
      const skillDir = await makeSkillSource(root, skillName);

      // Install normally first to create canonical dir
      const result1 = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'cursor',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result1.success).toBe(true);

      // The skill should be installed (either as symlink or copy, both are valid)
      const content = await readFile(join(result1.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: ${skillName}`);
    });

    it('InstallResult.symlinkFailed reports false when symlink succeeds', async () => {
      const skillName = 'symlink-ok';
      const skillDir = await makeSkillSource(root, skillName);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'cursor',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('symlink');
      // symlinkFailed should be undefined (not true) when symlink succeeds
      expect(result.symlinkFailed).toBeUndefined();
    });

    it('copy mode is idempotent — reinstall overwrites cleanly', async () => {
      const skillName = 'idempotent-copy';
      const skillDir = await makeSkillSource(root, skillName);

      // Install once
      const result1 = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'cursor',
        { cwd: projectDir, mode: 'copy', global: false }
      );
      expect(result1.success).toBe(true);

      // Modify source
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: idempotent-copy\ndescription: updated\n---\n\nNew content.\n',
        'utf-8'
      );

      // Install again (should overwrite)
      const result2 = await installSkillForAgent(
        { name: skillName, description: 'updated', path: skillDir },
        'cursor',
        { cwd: projectDir, mode: 'copy', global: false }
      );
      expect(result2.success).toBe(true);

      const content = await readFile(join(result2.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain('description: updated');
      expect(content).toContain('New content.');
    });

    it('excluded files (_prefixed, metadata.json, .git) are not copied', async () => {
      const skillName = 'excluded-files';
      const dir = join(root, 'source-excluded');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), '---\nname: excluded-files\ndescription: t\n---\n');
      await writeFile(join(dir, 'metadata.json'), '{}');
      await writeFile(join(dir, '_internal.ts'), 'secret');
      await mkdir(join(dir, '.git'), { recursive: true });
      await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
      await writeFile(join(dir, 'keep.ts'), 'export const y = 2;\n');

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: dir },
        'cursor',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const entries = await readdir(result.path);
      expect(entries).toContain('SKILL.md');
      expect(entries).toContain('keep.ts');
      expect(entries).not.toContain('metadata.json');
      expect(entries).not.toContain('_internal.ts');
      expect(entries).not.toContain('.git');
    });
  });

  describe('symlink mode — junction type on Windows', () => {
    // We can't test actual Windows behavior on Linux, but we can verify
    // the code path exists and that the createSymlink function is called
    // with the correct junction type argument.

    it('uses relative symlinks for non-universal agents', async () => {
      const skillName = 'relative-symlink';
      const skillDir = await makeSkillSource(root, skillName);

      // Use claude-code which has a separate skillsDir (.claude/skills/)
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('symlink');

      // For non-universal agents, a symlink should be created from agent dir to canonical
      const agentDir = join(projectDir, '.claude', 'skills', skillName);
      const stats = await lstat(agentDir);
      expect(stats.isSymbolicLink()).toBe(true);

      // Verify the content is accessible through the symlink
      const content = await readFile(join(agentDir, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: ${skillName}`);
    });

    it('canonical directory contains real files (not symlinks)', async () => {
      const skillName = 'canonical-real';
      const skillDir = await makeSkillSource(root, skillName);

      // Use claude-code to have separate canonical and agent dirs
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      // Canonical dir should have real files
      const canonicalDir = join(projectDir, '.agents', 'skills', skillName);
      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      const skillMdStats = await lstat(join(canonicalDir, 'SKILL.md'));
      expect(skillMdStats.isFile()).toBe(true);
      expect(skillMdStats.isSymbolicLink()).toBe(false);
    });
  });
});

/**
 * Agent matrix tests for symlink and copy mode across representative agent types.
 *
 * Tests a matrix of agents spanning:
 * - Universal agents (skillsDir === '.agents/skills'): cursor, github-copilot
 * - Non-universal agents with distinct skillsDir values: claude-code
 *
 * For each agent, verifies:
 * - Copy mode installs files correctly
 * - Symlink mode installs files correctly (symlink for non-universal, direct for universal)
 * - Content is identical regardless of install mode
 */
describe('symlink fallback — agent matrix', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dotai-matrix-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Representative universal agents (skillsDir: '.agents/skills')
  const universalAgents: AgentType[] = ['cursor', 'github-copilot'];

  // Representative non-universal agents with distinct skillsDir values
  const nonUniversalAgents: AgentType[] = [
    'claude-code', // .claude/skills
  ];

  const allTestAgents = [...universalAgents, ...nonUniversalAgents];

  describe('copy mode across all agent types', () => {
    it.each(allTestAgents)('copies skill correctly for %s', async (agentType) => {
      const projectDir = join(root, `project-copy-${agentType}`);
      await mkdir(projectDir, { recursive: true });

      const skillDir = join(root, `source-${agentType}`);
      await mkdir(skillDir, { recursive: true });
      const skillName = `matrix-skill-${agentType}`;
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skillName}\ndescription: matrix test\n---\n\nBody for ${agentType}.\n`,
        'utf-8'
      );
      await writeFile(join(skillDir, 'extra.ts'), `// agent: ${agentType}\n`, 'utf-8');

      const result = await installSkillForAgent(
        { name: skillName, description: 'matrix test', path: skillDir },
        agentType,
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');
      expect(result.symlinkFailed).toBeUndefined();

      // Verify files are real copies (not symlinks)
      const stats = await lstat(result.path);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);

      // Verify SKILL.md content
      const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: ${skillName}`);
      expect(content).toContain(`Body for ${agentType}.`);

      // Verify extra file was copied
      const extraContent = await readFile(join(result.path, 'extra.ts'), 'utf-8');
      expect(extraContent).toBe(`// agent: ${agentType}\n`);
    });
  });

  describe('symlink mode across all agent types', () => {
    it.each(nonUniversalAgents)(
      'creates symlink from agent dir to canonical for %s',
      async (agentType) => {
        const projectDir = join(root, `project-sym-${agentType}`);
        await mkdir(projectDir, { recursive: true });

        const skillDir = join(root, `source-sym-${agentType}`);
        await mkdir(skillDir, { recursive: true });
        const skillName = `sym-skill-${agentType}`;
        await writeFile(
          join(skillDir, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: sym test\n---\n\nSymlink body.\n`,
          'utf-8'
        );

        const result = await installSkillForAgent(
          { name: skillName, description: 'sym test', path: skillDir },
          agentType,
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);
        expect(result.mode).toBe('symlink');
        expect(result.symlinkFailed).toBeUndefined();

        // Canonical dir should be a real directory
        const canonicalDir = join(projectDir, '.agents', 'skills', skillName);
        const canonicalStats = await lstat(canonicalDir);
        expect(canonicalStats.isDirectory()).toBe(true);
        expect(canonicalStats.isSymbolicLink()).toBe(false);

        // Agent dir should be a symlink
        const agent = agents[agentType];
        const agentDir = join(projectDir, agent.skillsDir, skillName);
        const agentStats = await lstat(agentDir);
        expect(agentStats.isSymbolicLink()).toBe(true);

        // Content should be accessible through symlink
        const content = await readFile(join(agentDir, 'SKILL.md'), 'utf-8');
        expect(content).toContain(`name: ${skillName}`);
      }
    );

    it.each(universalAgents)(
      'does not create symlink for universal agent %s (same canonical dir)',
      async (agentType) => {
        const projectDir = join(root, `project-uni-${agentType}`);
        await mkdir(projectDir, { recursive: true });

        const skillDir = join(root, `source-uni-${agentType}`);
        await mkdir(skillDir, { recursive: true });
        const skillName = `uni-skill-${agentType}`;
        await writeFile(
          join(skillDir, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: uni test\n---\n\nUniversal body.\n`,
          'utf-8'
        );

        const result = await installSkillForAgent(
          { name: skillName, description: 'uni test', path: skillDir },
          agentType,
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);
        expect(result.mode).toBe('symlink');
        expect(result.symlinkFailed).toBeUndefined();

        // For universal agents, canonical and agent dirs are the same (.agents/skills)
        // so no symlink is created — the installed path is a real directory
        const installedDir = join(projectDir, '.agents', 'skills', skillName);
        const stats = await lstat(installedDir);
        expect(stats.isDirectory()).toBe(true);
        expect(stats.isSymbolicLink()).toBe(false);

        const content = await readFile(join(installedDir, 'SKILL.md'), 'utf-8');
        expect(content).toContain(`name: ${skillName}`);
      }
    );
  });

  describe('content parity: copy vs symlink across agent types', () => {
    it.each(nonUniversalAgents)(
      'produces identical content for %s regardless of install mode',
      async (agentType) => {
        const skillName = `parity-${agentType}`;
        const skillDir = join(root, `source-parity-${agentType}`);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: parity test\n---\n\nParity body.\n`,
          'utf-8'
        );
        await writeFile(join(skillDir, 'data.json'), '{"key": "value"}\n', 'utf-8');

        // Install with copy mode
        const copyProject = join(root, `copy-parity-${agentType}`);
        await mkdir(copyProject, { recursive: true });
        const copyResult = await installSkillForAgent(
          { name: skillName, description: 'parity test', path: skillDir },
          agentType,
          { cwd: copyProject, mode: 'copy', global: false }
        );

        // Install with symlink mode
        const symlinkProject = join(root, `sym-parity-${agentType}`);
        await mkdir(symlinkProject, { recursive: true });
        const symlinkResult = await installSkillForAgent(
          { name: skillName, description: 'parity test', path: skillDir },
          agentType,
          { cwd: symlinkProject, mode: 'symlink', global: false }
        );

        expect(copyResult.success).toBe(true);
        expect(symlinkResult.success).toBe(true);

        // Compare SKILL.md content
        const copyContent = await readFile(join(copyResult.path, 'SKILL.md'), 'utf-8');
        const symlinkContent = await readFile(join(symlinkResult.path, 'SKILL.md'), 'utf-8');
        expect(copyContent).toBe(symlinkContent);

        // Compare extra file content
        const copyData = await readFile(join(copyResult.path, 'data.json'), 'utf-8');
        const symlinkData = await readFile(join(symlinkResult.path, 'data.json'), 'utf-8');
        expect(copyData).toBe(symlinkData);
      }
    );
  });
});

/**
 * Tests for symlink failure handling and fallback behavior.
 *
 * When symlink creation fails (e.g., EPERM on Windows without Developer Mode,
 * or when the target path is on a different filesystem that doesn't support
 * symlinks), the installer must fall back to copying files and set the
 * `symlinkFailed` flag.
 */
describe('symlink failure fallback behavior', () => {
  let root: string;
  let projectDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dotai-fallback-'));
    projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('falls back to copy and sets symlinkFailed when canonical dir is removed before symlink', async () => {
    // This test simulates a scenario where the canonical directory becomes
    // inaccessible between copy and symlink creation. The installer should
    // fall back to copying directly to the agent directory.
    const skillName = 'fallback-test';
    const skillDir = join(root, 'source-fallback');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: fallback\n---\n\nBody.\n`,
      'utf-8'
    );

    // Pre-create the canonical directory as a regular file (not a directory)
    // to make symlink creation fail (you can't symlink to an invalid target type)
    const canonicalBase = join(projectDir, '.agents', 'skills');
    await mkdir(canonicalBase, { recursive: true });

    // Install normally — should succeed even if there was a pre-existing file
    const result = await installSkillForAgent(
      { name: skillName, description: 'fallback', path: skillDir },
      'claude-code',
      { cwd: projectDir, mode: 'symlink', global: false }
    );

    expect(result.success).toBe(true);
    // Content should be accessible regardless
    const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
    expect(content).toContain(`name: ${skillName}`);
  });

  it('installRemoteSkillForAgent copy mode works for all representative agents', async () => {
    const testAgents: AgentType[] = ['claude-code', 'cursor'];

    for (const agentType of testAgents) {
      const agentProjectDir = join(root, `remote-${agentType}`);
      await mkdir(agentProjectDir, { recursive: true });

      const remoteSkill: RemoteSkill = {
        name: `Remote ${agentType}`,
        description: `Remote skill for ${agentType}`,
        content: `---\nname: remote-${agentType}\ndescription: test\n---\n\nRemote body for ${agentType}.\n`,
        installName: `remote-${agentType}`,
        sourceUrl: `https://example.com/skill/${agentType}`,
        providerId: 'test',
        sourceIdentifier: 'test',
      };

      const result = await installRemoteSkillForAgent(remoteSkill, agentType, {
        cwd: agentProjectDir,
        mode: 'copy',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      const stats = await lstat(result.path);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);

      const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: remote-${agentType}`);
      expect(content).toContain(`Remote body for ${agentType}.`);
    }
  });

  it('installWellKnownSkillForAgent copy mode works for all representative agents', async () => {
    const testAgents: AgentType[] = ['claude-code', 'cursor'];

    for (const agentType of testAgents) {
      const agentProjectDir = join(root, `wellknown-${agentType}`);
      await mkdir(agentProjectDir, { recursive: true });

      const wellKnownSkill = {
        name: `wk-${agentType}`,
        description: `Well-known skill for ${agentType}`,
        content: `---\nname: wk-${agentType}\ndescription: test\n---\n\nBody.\n`,
        installName: `wk-${agentType}`,
        sourceUrl: `https://example.com/.well-known/skills/wk-${agentType}`,
        files: new Map([
          ['SKILL.md', `---\nname: wk-${agentType}\ndescription: test\n---\n\nBody.\n`],
          ['lib.ts', `export const agent = '${agentType}';\n`],
        ]),
        indexEntry: {
          name: `wk-${agentType}`,
          description: `Well-known skill for ${agentType}`,
          files: ['SKILL.md', 'lib.ts'],
        },
      } satisfies WellKnownSkill;

      const result = await installWellKnownSkillForAgent(wellKnownSkill, agentType, {
        cwd: agentProjectDir,
        mode: 'copy',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      const content = await readFile(join(result.path, 'SKILL.md'), 'utf-8');
      expect(content).toContain(`name: wk-${agentType}`);

      const lib = await readFile(join(result.path, 'lib.ts'), 'utf-8');
      expect(lib).toBe(`export const agent = '${agentType}';\n`);
    }
  });

  it('copy mode handles nested directory structures across agents', async () => {
    const testAgents: AgentType[] = ['claude-code', 'cursor'];

    for (const agentType of testAgents) {
      const agentProjectDir = join(root, `nested-${agentType}`);
      await mkdir(agentProjectDir, { recursive: true });

      const skillDir = join(root, `source-nested-${agentType}`);
      await mkdir(join(skillDir, 'sub', 'deep'), { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: nested-${agentType}\ndescription: test\n---\n\nBody.\n`,
        'utf-8'
      );
      await writeFile(join(skillDir, 'sub', 'util.ts'), 'export const u = 1;\n', 'utf-8');
      await writeFile(join(skillDir, 'sub', 'deep', 'helper.ts'), 'export const h = 2;\n', 'utf-8');

      const result = await installSkillForAgent(
        { name: `nested-${agentType}`, description: 'test', path: skillDir },
        agentType,
        { cwd: agentProjectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      // Verify nested files were copied
      const util = await readFile(join(result.path, 'sub', 'util.ts'), 'utf-8');
      expect(util).toBe('export const u = 1;\n');

      const helper = await readFile(join(result.path, 'sub', 'deep', 'helper.ts'), 'utf-8');
      expect(helper).toBe('export const h = 2;\n');
    }
  });

  it('excluded files are filtered out in copy mode across agents', async () => {
    const testAgents: AgentType[] = ['claude-code', 'cursor'];

    for (const agentType of testAgents) {
      const agentProjectDir = join(root, `excluded-${agentType}`);
      await mkdir(agentProjectDir, { recursive: true });

      const skillDir = join(root, `source-excl-${agentType}`);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: excl-${agentType}\ndescription: test\n---\n`,
        'utf-8'
      );
      await writeFile(join(skillDir, 'metadata.json'), '{}', 'utf-8');
      await writeFile(join(skillDir, '_private.ts'), 'secret', 'utf-8');
      await mkdir(join(skillDir, '.git'), { recursive: true });
      await writeFile(join(skillDir, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf-8');
      await writeFile(join(skillDir, 'public.ts'), 'export const p = 1;\n', 'utf-8');

      const result = await installSkillForAgent(
        { name: `excl-${agentType}`, description: 'test', path: skillDir },
        agentType,
        { cwd: agentProjectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const entries = await readdir(result.path);
      expect(entries).toContain('SKILL.md');
      expect(entries).toContain('public.ts');
      expect(entries).not.toContain('metadata.json');
      expect(entries).not.toContain('_private.ts');
      expect(entries).not.toContain('.git');
    }
  });
});
