import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { addRules } from '../src/rule-add.ts';
import { executeInstallPipeline } from '../src/rule-installer.ts';
import { discover, filterByType } from '../src/rule-discovery.ts';

describe('debug addRules', () => {
  it('shows full pipeline result', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'dbg-proj-'));
    execSync('git init --initial-branch=main', { cwd: projectRoot, stdio: 'ignore' });

    const sourceRepo = mkdtempSync(join(tmpdir(), 'dbg-src-'));
    const ruleDir = join(sourceRepo, 'rules', 'code-style');
    mkdirSync(ruleDir, { recursive: true });
    writeFileSync(
      join(ruleDir, 'RULES.md'),
      `---
name: code-style
description: Code style guidelines
activation: always
---

Use consistent formatting.
`
    );

    // Step 1: Check discovery
    const { items, warnings } = await discover(sourceRepo, { types: ['rule'] });
    console.log(
      'DISCOVERY items:',
      items.length,
      items.map((i) => `${i.type}:${i.name}:${i.format}`)
    );
    console.log('DISCOVERY warnings:', warnings);

    const allRules = filterByType(items, 'rule');
    console.log('FILTERED rules:', allRules.length);

    // Step 2: Run install pipeline directly
    const pipelineResult = await executeInstallPipeline(allRules, {
      projectRoot,
      source: 'test/e2e-repo',
    });

    console.log('PIPELINE success:', pipelineResult.success);
    console.log(
      'PIPELINE writes:',
      pipelineResult.writes.length,
      pipelineResult.writes.map((w) => `${w.agent}:${w.planned.absolutePath}`)
    );
    console.log('PIPELINE written:', pipelineResult.written.length, pipelineResult.written);
    console.log('PIPELINE skipped:', pipelineResult.skipped);
    console.log('PIPELINE collisions:', pipelineResult.collisions);
    console.log('PIPELINE error:', pipelineResult.error);

    // Step 3: Check if files actually exist
    const opencodePath = join(projectRoot, '.opencode', 'rules');
    console.log('.opencode/rules exists:', existsSync(opencodePath));
    if (existsSync(opencodePath)) {
      console.log('.opencode/rules contents:', readdirSync(opencodePath));
    }

    // Step 4: Now run addRules
    const result = await addRules({
      source: 'test/e2e-repo',
      sourcePath: sourceRepo,
      projectRoot,
      ruleNames: ['*'],
      force: true, // force to overwrite from pipeline above
    });

    console.log('ADDRULES success:', result.success);
    console.log('ADDRULES rulesInstalled:', result.rulesInstalled);
    console.log('ADDRULES writtenPaths:', result.writtenPaths.length, result.writtenPaths);
    console.log('ADDRULES error:', result.error);
    console.log('ADDRULES messages:', result.messages);

    // Check lock file
    const lockPath = join(projectRoot, '.dotai-lock.json');
    console.log('LOCK EXISTS:', existsSync(lockPath));

    expect(true).toBe(true);
  });
});
