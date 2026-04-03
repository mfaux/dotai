import { spawnSync } from 'child_process';
import {
  fetchSkillFolderHash,
  getGitHubToken,
  readSkillLock,
  type SkillLockEntry,
} from './skill-lock.ts';
import { checkContextUpdates, updateContext } from './context-check.ts';
import { track } from './telemetry.ts';
import { RESET, DIM, TEXT } from './utils.ts';

// ============================================
// Shared skill update detection
// ============================================

/**
 * A skill that has an available update.
 */
export interface SkillUpdate {
  /** Skill name. */
  name: string;
  /** Source identifier (e.g., "owner/repo"). */
  source: string;
  /** Full lock entry (only present when needed for update). */
  entry: SkillLockEntry;
}

/**
 * A skill that could not be checked.
 */
export interface SkillCheckError {
  /** Skill name. */
  name: string;
  /** Source identifier. */
  source: string;
  /** Error message. */
  error: string;
}

/**
 * Result of checking skills for updates.
 */
export interface SkillCheckResult {
  /** Skills with available updates. */
  updates: SkillUpdate[];
  /** Skills that could not be checked. */
  errors: SkillCheckError[];
  /** Number of skills that were checked (excludes skipped non-GitHub sources). */
  checkedCount: number;
}

/**
 * Find skill updates by comparing lock file hashes against GitHub.
 *
 * Reads the global skill lock, iterates over GitHub-sourced skills,
 * fetches the current tree SHA via GitHub API, and returns which
 * skills have changed. Skips non-GitHub sources and entries without
 * `skillFolderHash` or `skillPath`.
 */
export async function findSkillUpdates(
  skills: Record<string, SkillLockEntry>,
  token: string | null
): Promise<SkillCheckResult> {
  const updates: SkillUpdate[] = [];
  const errors: SkillCheckError[] = [];

  // Group skills by source for future optimization (batch API calls per repo)
  const skillsBySource = new Map<string, Array<{ name: string; entry: SkillLockEntry }>>();
  let skippedCount = 0;

  for (const [skillName, entry] of Object.entries(skills)) {
    if (!entry) continue;

    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      skippedCount++;
      continue;
    }

    const existing = skillsBySource.get(entry.source) || [];
    existing.push({ name: skillName, entry });
    skillsBySource.set(entry.source, existing);
  }

  const checkedCount = Object.keys(skills).length - skippedCount;

  for (const [, skillGroup] of skillsBySource) {
    for (const { name, entry } of skillGroup) {
      try {
        const latestHash = await fetchSkillFolderHash(
          entry.source,
          entry.skillPath!,
          token,
          entry.ref
        );

        if (!latestHash) {
          errors.push({ name, source: entry.source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.skillFolderHash) {
          updates.push({ name, source: entry.source, entry });
        }
      } catch (err) {
        errors.push({
          name,
          source: entry.source,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return { updates, errors, checkedCount };
}

// ============================================
// Check Command
// ============================================

export async function runCheck(_args: string[] = []): Promise<void> {
  console.log(`${TEXT}Checking for updates...${RESET}`);
  console.log();

  let hasAnyItems = false;
  let totalUpdates = 0;

  // ── Check skills (global lock: ~/.agents/.skill-lock.json) ──
  const lock = await readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length > 0) {
    hasAnyItems = true;

    const token = getGitHubToken();
    const result = await findSkillUpdates(lock.skills, token);

    if (result.checkedCount > 0) {
      console.log(`${DIM}Checking ${result.checkedCount} skill(s)...${RESET}`);

      if (result.updates.length > 0) {
        totalUpdates += result.updates.length;
        for (const update of result.updates) {
          console.log(`  ${TEXT}↑${RESET} ${update.name} ${DIM}(skill)${RESET}`);
          console.log(`    ${DIM}source: ${update.source}${RESET}`);
        }
      }

      if (result.errors.length > 0) {
        console.log(
          `${DIM}  Could not check ${result.errors.length} skill(s) (may need reinstall)${RESET}`
        );
      }

      track({
        event: 'check',
        skillCount: String(result.checkedCount),
        updatesAvailable: String(result.updates.length),
      });
    }
  }

  // ── Check rules, prompts, agents, and instructions (project lock: .dotai-lock.json) ──
  const projectRoot = process.cwd();
  const ruleCheck = await checkContextUpdates(projectRoot);

  if (ruleCheck.totalChecked > 0) {
    hasAnyItems = true;
    console.log(
      `${DIM}Checking ${ruleCheck.totalChecked} rule/prompt/agent/instruction(s)...${RESET}`
    );

    if (ruleCheck.updates.length > 0) {
      totalUpdates += ruleCheck.updates.length;
      for (const update of ruleCheck.updates) {
        console.log(`  ${TEXT}↑${RESET} ${update.entry.name} ${DIM}(${update.entry.type})${RESET}`);
        console.log(`    ${DIM}source: ${update.entry.source}${RESET}`);
      }
    }

    if (ruleCheck.errors.length > 0) {
      console.log(
        `${DIM}  Could not check ${ruleCheck.errors.length} item(s) (may need reinstall)${RESET}`
      );
    }

    track({
      event: 'check-rules',
      ruleCount: String(ruleCheck.totalChecked),
      updatesAvailable: String(ruleCheck.updates.length),
    });
  }

  // ── Summary ──
  if (!hasAnyItems) {
    console.log(`${DIM}No items tracked in lock file.${RESET}`);
    console.log(`${DIM}Install context with${RESET} ${TEXT}npx dotai add <package>${RESET}`);
    console.log();
    return;
  }

  console.log();
  if (totalUpdates === 0) {
    console.log(`${TEXT}✓ All items are up to date${RESET}`);
  } else {
    console.log(`${TEXT}${totalUpdates} update(s) available${RESET}`);
    console.log();
    console.log(
      `${DIM}Run${RESET} ${TEXT}npx dotai update${RESET} ${DIM}to update all items${RESET}`
    );
  }

  console.log();
}

// ============================================
// Update Command
// ============================================

export async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for updates...${RESET}`);
  console.log();

  let hasAnyItems = false;
  let totalSuccess = 0;
  let totalFail = 0;

  // ── Update skills (global lock: ~/.agents/.skill-lock.json) ──
  const lock = await readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length > 0) {
    hasAnyItems = true;

    const token = getGitHubToken();
    const result = await findSkillUpdates(lock.skills, token);

    if (result.checkedCount > 0 && result.updates.length > 0) {
      console.log(`${TEXT}Found ${result.updates.length} skill update(s)${RESET}`);
      console.log();

      for (const update of result.updates) {
        console.log(`${TEXT}Updating ${update.name}...${RESET}`);

        let installUrl = update.entry.sourceUrl;
        if (update.entry.skillPath) {
          let skillFolder = update.entry.skillPath;
          if (skillFolder.endsWith('/SKILL.md')) {
            skillFolder = skillFolder.slice(0, -9);
          } else if (skillFolder.endsWith('SKILL.md')) {
            skillFolder = skillFolder.slice(0, -8);
          }
          if (skillFolder.endsWith('/')) {
            skillFolder = skillFolder.slice(0, -1);
          }

          installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
          const branch = update.entry.ref || 'main';
          installUrl = `${installUrl}/tree/${branch}/${skillFolder}`;
        }

        const spawnResult = spawnSync('npx', ['-y', 'dotai', 'add', installUrl, '-g', '-y'], {
          stdio: ['inherit', 'pipe', 'pipe'],
        });

        if (spawnResult.status === 0) {
          totalSuccess++;
          console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
        } else {
          totalFail++;
          console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
        }
      }

      track({
        event: 'update',
        skillCount: String(result.updates.length),
        successCount: String(totalSuccess),
        failCount: String(totalFail),
      });
    }
  }

  // ── Update rules, prompts, agents, and instructions (project lock: .dotai-lock.json) ──
  const projectRoot = process.cwd();
  const ruleResult = await updateContext(projectRoot);

  if (ruleResult.totalChecked > 0) {
    hasAnyItems = true;

    if (ruleResult.successCount > 0 || ruleResult.failCount > 0) {
      for (const msg of ruleResult.messages) {
        console.log(`  ${msg}`);
      }
      totalSuccess += ruleResult.successCount;
      totalFail += ruleResult.failCount;
    }

    track({
      event: 'update-rules',
      ruleCount: String(ruleResult.totalChecked),
      successCount: String(ruleResult.successCount),
      failCount: String(ruleResult.failCount),
    });
  }

  // ── Summary ──
  if (!hasAnyItems) {
    console.log(`${DIM}No items tracked in lock file.${RESET}`);
    console.log(`${DIM}Install context with${RESET} ${TEXT}npx dotai add <package>${RESET}`);
    console.log();
    return;
  }

  const totalUpdated = totalSuccess + totalFail;
  if (totalUpdated === 0) {
    console.log(`${TEXT}✓ All items are up to date${RESET}`);
  } else {
    console.log();
    if (totalSuccess > 0) {
      console.log(`${TEXT}✓ Updated ${totalSuccess} item(s)${RESET}`);
    }
    if (totalFail > 0) {
      console.log(`${DIM}Failed to update ${totalFail} item(s)${RESET}`);
    }
  }

  console.log();
}
