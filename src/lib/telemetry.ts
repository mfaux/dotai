// Telemetry and audit are disabled until dotai has its own infrastructure.
// The upstream URLs (add-skill.vercel.sh) belonged to the original project;
// dotai must not send user data to a third-party domain.
const TELEMETRY_URL: string | null = null;
const AUDIT_URL: string | null = null;

interface InstallTelemetryData {
  event: 'install';
  source: string;
  skills: string;
  agents: string;
  global?: '1';
  skillFiles?: string; // JSON stringified { skillName: relativePath }
  /**
   * Source type for different hosts:
   * - 'github': GitHub repository (default, uses raw.githubusercontent.com)
   * - 'raw': Direct URL to SKILL.md (generic raw URL)
   * - Provider IDs like 'mintlify', 'huggingface', etc.
   */
  sourceType?: string;
}

interface RemoveTelemetryData {
  event: 'remove';
  source?: string;
  skills: string;
  agents: string;
  global?: '1';
  sourceType?: string;
}

interface CheckTelemetryData {
  event: 'check';
  skillCount: string;
  updatesAvailable: string;
}

interface CheckRulesTelemetryData {
  event: 'check-rules';
  ruleCount: string;
  updatesAvailable: string;
}

interface UpdateTelemetryData {
  event: 'update';
  skillCount: string;
  successCount: string;
  failCount: string;
}

interface UpdateRulesTelemetryData {
  event: 'update-rules';
  ruleCount: string;
  successCount: string;
  failCount: string;
}

interface FindTelemetryData {
  event: 'find';
  query: string;
  resultCount: string;
  interactive?: '1';
}

interface SyncTelemetryData {
  event: 'experimental_sync';
  skillCount: string;
  successCount: string;
  agents: string;
}

type TelemetryData =
  | InstallTelemetryData
  | RemoveTelemetryData
  | CheckTelemetryData
  | CheckRulesTelemetryData
  | UpdateTelemetryData
  | UpdateRulesTelemetryData
  | FindTelemetryData
  | SyncTelemetryData;

let cliVersion: string | null = null;

function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL ||
    process.env.TEAMCITY_VERSION
  );
}

function isEnabled(): boolean {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}

export function setVersion(version: string): void {
  cliVersion = version;
}

// ─── Security audit data ───

export interface PartnerAudit {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  alerts?: number;
  score?: number;
  analyzedAt: string;
}

export type SkillAuditData = Record<string, PartnerAudit>;
export type AuditResponse = Record<string, SkillAuditData>;

/**
 * Fetch security audit results for skills from the audit API.
 * Returns null on any error or timeout — never blocks installation.
 */
export async function fetchAuditData(
  source: string,
  skillSlugs: string[],
  timeoutMs = 3000
): Promise<AuditResponse | null> {
  if (!AUDIT_URL || skillSlugs.length === 0) return null;

  try {
    const params = new URLSearchParams({
      source,
      skills: skillSlugs.join(','),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${AUDIT_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    return (await response.json()) as AuditResponse;
  } catch {
    return null;
  }
}

export function track(data: TelemetryData): void {
  if (!TELEMETRY_URL || !isEnabled()) return;

  try {
    const params = new URLSearchParams();

    // Add version
    if (cliVersion) {
      params.set('v', cliVersion);
    }

    // Add CI flag if running in CI
    if (isCI()) {
      params.set('ci', '1');
    }

    // Add event data
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }

    // Fire and forget - don't await, silently ignore errors
    fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {});
  } catch {
    // Silently fail - telemetry should never break the CLI
  }
}
