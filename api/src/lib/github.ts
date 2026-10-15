import type { DeployResult } from '../../../src/domain/api-types.ts';
import type { Config } from './config.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function deployConfigured(config: Config): boolean {
  return Boolean(config.github.token && config.github.repo);
}

/** Starts the site's deploy workflow. Never throws: a publish must not fail because GitHub did. */
export async function startDeploy(config: Config, fetchImpl: Fetch = fetch): Promise<DeployResult> {
  if (!deployConfigured(config)) {
    return {
      started: false,
      message: 'Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App.',
    };
  }
  const { token, repo, branch, workflow } = config.github;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'fabric-credit-ratings-api',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: branch }),
    });
    if (response.status === 204) {
      return { started: true, message: 'The public site is rebuilding. It updates in about two minutes.' };
    }
    return {
      started: false,
      message:
        `GitHub refused the site update (HTTP ${response.status}). Run the deploy workflow from the Actions tab.`,
    };
  } catch {
    return { started: false, message: 'GitHub did not respond. Try Update public site again in a minute.' };
  }
}
