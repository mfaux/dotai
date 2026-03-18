import { getGitHubToken } from './skill-lock.ts';

export interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

/**
 * Fetch the full recursive tree for a GitHub repo.
 * Tries the given ref first, then main, then master.
 * Returns null on failure (rate limit, private repo, network error).
 */
export async function fetchRepoTree(
  ownerRepo: string,
  ref?: string | null
): Promise<GitHubTreeEntry[] | null> {
  const token = getGitHubToken();
  const branches = ref ? [ref, 'main', 'master'] : ['main', 'master'];

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dotai',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        sha: string;
        tree: Array<{ path: string; type: string; sha: string }>;
      };

      return data.tree.map((entry) => ({
        path: entry.path,
        type: entry.type as 'blob' | 'tree',
        sha: entry.sha,
      }));
    } catch {
      continue;
    }
  }

  return null;
}
