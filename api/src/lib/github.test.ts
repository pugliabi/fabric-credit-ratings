import { describe, expect, it, vi } from 'vitest';
import type { Config } from './config.ts';
import { deployConfigured, startDeploy } from './github.ts';

function config(token: string): Config {
  return {
    allowedOrigins: [],
    cookieSecure: true,
    snapshotToken: '',
    github: { token, repo: 'owner/repo', branch: 'main', workflow: 'deploy.yml' },
    anthropic: { apiKey: '', workspaceId: '', model: '' },
  };
}

describe('startDeploy', () => {
  it('says so when dispatch is not set up', async () => {
    expect(deployConfigured(config(''))).toBe(false);
    expect((await startDeploy(config(''))).started).toBe(false);
  });

  it('dispatches the deploy workflow on the configured branch', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    expect((await startDeploy(config('tok'), fetchImpl)).started).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/deploy.yml/dispatches');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('explains a refusal', async () => {
    const result = await startDeploy(config('tok'), async () => new Response('nope', { status: 403 }));
    expect(result).toEqual({
      started: false,
      message: 'GitHub refused the site update (HTTP 403). Run the deploy workflow from the Actions tab.',
    });
  });

  it('survives a network failure', async () => {
    const result = await startDeploy(config('tok'), async () => {
      throw new Error('offline');
    });
    expect(result.started).toBe(false);
  });
});
