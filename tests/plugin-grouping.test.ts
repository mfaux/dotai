import { join, resolve } from 'path';
import { getPluginGroupings } from '../src/lib/plugin-manifest.ts';
import { discoverSkills } from '../src/lib/discovery/index.ts';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const TEST_DIR = join(process.cwd(), 'test-plugin-grouping');

describe('getPluginGroupings', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, '.claude-plugin'), { recursive: true });

    const manifest = {
      plugins: [
        {
          name: 'document-skills',
          source: './',
          skills: ['./skills/xlsx', './skills/docx'],
        },
        {
          name: 'example-skills',
          source: './',
          skills: ['./skills/art'],
        },
      ],
    };

    await writeFile(join(TEST_DIR, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should map skill paths to plugin names', async () => {
    const groupings = await getPluginGroupings(TEST_DIR);

    const xlsxPath = resolve(TEST_DIR, 'skills/xlsx');
    const docxPath = resolve(TEST_DIR, 'skills/docx');
    const artPath = resolve(TEST_DIR, 'skills/art');

    expect(groupings.get(xlsxPath)).toBe('document-skills');
    expect(groupings.get(docxPath)).toBe('document-skills');
    expect(groupings.get(artPath)).toBe('example-skills');
  });

  it('should handle nested plugin sources', async () => {
    // Create nested structure
    const nestedDir = join(TEST_DIR, 'nested');
    await mkdir(nestedDir, { recursive: true });
    await mkdir(join(nestedDir, '.claude-plugin'), { recursive: true });

    const manifest = {
      plugins: [
        {
          name: 'nested-plugin',
          source: './plugins/my-plugin',
          skills: ['./skills/deep'],
        },
      ],
    };

    await writeFile(join(nestedDir, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));

    const groupings = await getPluginGroupings(nestedDir);
    // source: ./plugins/my-plugin, skill: ./skills/deep
    // path = nestedDir/plugins/my-plugin/skills/deep
    const expectedPath = resolve(nestedDir, 'plugins/my-plugin/skills/deep');

    expect(groupings.get(expectedPath)).toBe('nested-plugin');
  });
});

describe('discoverSkills plugin grouping integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `plugin-grouping-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should set pluginName on discovered skills from marketplace.json', async () => {
    // Create marketplace.json with named plugins
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'document-skills',
            source: './',
            skills: ['./skills/xlsx'],
          },
          {
            name: 'example-skills',
            source: './',
            skills: ['./skills/art'],
          },
        ],
      })
    );

    // Create skill directories with SKILL.md
    mkdirSync(join(testDir, 'skills/xlsx'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/xlsx/SKILL.md'),
      `---
name: xlsx-skill
description: Excel skill
---
# XLSX
`
    );

    mkdirSync(join(testDir, 'skills/art'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/art/SKILL.md'),
      `---
name: art-skill
description: Art skill
---
# Art
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(2);

    const xlsx = skills.find((s) => s.name === 'xlsx-skill');
    const art = skills.find((s) => s.name === 'art-skill');

    expect(xlsx).toBeDefined();
    expect(xlsx!.pluginName).toBe('document-skills');
    expect(art).toBeDefined();
    expect(art!.pluginName).toBe('example-skills');
  });

  it('should set pluginName on discovered skills from plugin.json', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'my-plugin',
        skills: ['./skills/my-skill'],
      })
    );

    mkdirSync(join(testDir, 'skills/my-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/my-skill/SKILL.md'),
      `---
name: my-skill
description: My skill
---
# My Skill
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].pluginName).toBe('my-plugin');
  });
});
