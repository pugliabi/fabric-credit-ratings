import type { DeployResult } from '../../../src/domain/api-types.ts';
import type { Config } from './config.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Publish's HTTP response waits on this call, and Azure cuts HTTP functions off at about 230 seconds. */
const DISPATCH_TIMEOUT_MS = 10_000;

const MANUAL = 'Until then, run the deploy workflow from the Actions tab.';

function refusal(status: number): string {
  const prefix = `GitHub refused the site update (HTTP ${status}).`;
  if (status === 401 || status === 403) {
    return (
      `${prefix} The GITHUB_DISPATCH_TOKEN is invalid or expired: create a new one that can run Actions on the repo ` +
      `and update that setting in the Function App. ${MANUAL}`
    );
  }
  if (status === 404) {
    return (
      `${prefix} Check GITHUB_REPO and GITHUB_WORKFLOW in the Function App, and that the token can see that repo. ` +
      MANUAL
    );
  }
  return `${prefix} Run the deploy workflow from the Actions tab.`;
}

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
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (response.ok) {
      return { started: true, message: 'The public site is rebuilding. It updates in about two minutes.' };
    }
    return { started: false, message: refusal(response.status) };
  } catch {
    // Includes the timeout: an aborted fetch rejects with a TimeoutError.
    return { started: false, message: 'GitHub did not respond. Try Update public site again in a minute.' };
  }
}
