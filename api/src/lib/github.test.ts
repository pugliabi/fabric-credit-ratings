import { describe, expect, it, vi } from 'vitest';
import type { Config } from './config.ts';
import { deployConfigured, startDeploy } from './github.ts';

function config(token: string, repo = 'owner/repo'): Config {
  return {
    allowedOrigins: [],
    cookieSecure: true,
    snapshotToken: '',
    github: { token, repo, branch: 'release', workflow: 'site.yml' },
    anthropic: { apiKey: '', workspaceId: '', model: '' },
  };
}

const started = { started: true, message: 'The public site is rebuilding. It updates in about two minutes.' };

function refusedWith(status: number) {
  return startDeploy(config('tok'), async () => new Response('{"message":"nope"}', { status }));
}

describe('startDeploy', () => {
  it('says so when dispatch is not set up, without calling GitHub', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    expect(deployConfigured(config(''))).toBe(false);
    expect(deployConfigured(config('tok', ''))).toBe(false);
    const notSetUp = {
      started: false,
      message: 'Automatic site updates are not set up. Set GITHUB_DISPATCH_TOKEN and GITHUB_REPO in the Function App.',
    };
    expect(await startDeploy(config(''), fetchImpl)).toEqual(notSetUp);
    expect(await startDeploy(config('tok', ''), fetchImpl)).toEqual(notSetUp);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dispatches the configured workflow on the configured branch, with a timeout', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    expect(await startDeploy(config('tok'), fetchImpl)).toEqual(started);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/site.yml/dispatches');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ ref: 'release' }) });
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('counts any 2xx as started', async () => {
    const result = await startDeploy(config('tok'), async () => new Response('{"workflow_run_id":1}', { status: 200 }));
    expect(result).toEqual(started);
  });

  it('says to replace the token when GitHub rejects it', async () => {
    const tokenFix =
      'The GITHUB_DISPATCH_TOKEN is invalid or expired: create a new one that can run Actions on the repo and ' +
      'update that setting in the Function App. Until then, run the deploy workflow from the Actions tab.';
    expect(await refusedWith(401)).toEqual({
      started: false,
      message: `GitHub refused the site update (HTTP 401). ${tokenFix}`,
    });
    expect(await refusedWith(403)).toEqual({
      started: false,
      message: `GitHub refused the site update (HTTP 403). ${tokenFix}`,
    });
  });

  it('says to check the repo and workflow settings on a 404', async () => {
    expect(await refusedWith(404)).toEqual({
      started: false,
      message:
        'GitHub refused the site update (HTTP 404). Check GITHUB_REPO and GITHUB_WORKFLOW in the Function App, ' +
        'and that the token can see that repo. Until then, run the deploy workflow from the Actions tab.',
    });
  });

  it('explains any other refusal generically', async () => {
    expect(await refusedWith(422)).toEqual({
      started: false,
      message: 'GitHub refused the site update (HTTP 422). Run the deploy workflow from the Actions tab.',
    });
  });

  it('survives a network failure or a timeout', async () => {
    const noAnswer = { started: false, message: 'GitHub did not respond. Try Update public site again in a minute.' };
    const offline = await startDeploy(config('tok'), async () => {
      throw new Error('offline');
    });
    expect(offline).toEqual(noAnswer);
    const timedOut = await startDeploy(config('tok'), async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(timedOut).toEqual(noAnswer);
  });
});
