import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeployResult } from '../../../src/domain/api-types.ts';
import type { Config } from '../lib/config.ts';
import { deployConfigured, startDeploy } from '../lib/github.ts';
import type { UserCtx } from '../lib/http.ts';
import { siteState } from '../repo/site.ts';
import './admin-site.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), () => ({
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/github.ts'), () => ({ deployConfigured: vi.fn(), startDeploy: vi.fn() }));
vi.mock(import('../repo/site.ts'), async (importOriginal) => ({ ...(await importOriginal()), siteState: vi.fn() }));

const config = {} as Config;
const log = { warn: vi.fn() };

function call(name: string): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  return handler({ params: {}, body: {}, config, log } as unknown as UserCtx);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('adminSite', () => {
  it('reports the last snapshot, whether a change since then makes the site behind, and whether deploys are set up', async () => {
    const lastSnapshotAt = new Date('2026-10-15T21:20:30.893Z');
    vi.mocked(siteState).mockResolvedValue({ lastSnapshotAt, changedAt: null });
    vi.mocked(deployConfigured).mockReturnValue(false);

    expect(await call('adminSite')).toEqual({
      lastSnapshotAt: lastSnapshotAt.toISOString(),
      behind: false,
      deployConfigured: false,
    });

    vi.mocked(siteState).mockResolvedValue({ lastSnapshotAt: null, changedAt: null });
    expect(await call('adminSite')).toMatchObject({ lastSnapshotAt: null, behind: true });
  });
});

describe('adminSiteUpdate', () => {
  it('returns the result when the deploy starts', async () => {
    const started: DeployResult = { started: true, message: 'The public site is rebuilding.' };
    vi.mocked(startDeploy).mockResolvedValue(started);

    expect(await call('adminSiteUpdate')).toEqual(started);
    expect(startDeploy).toHaveBeenCalledWith(config);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs why and answers 502 with the message when the deploy does not start', async () => {
    const refused: DeployResult = { started: false, message: 'Automatic site updates are not set up.' };
    vi.mocked(startDeploy).mockResolvedValue(refused);

    await expect(call('adminSiteUpdate')).rejects.toMatchObject({ status: 502, message: refused.message });
    expect(log.warn).toHaveBeenCalledWith('The site deploy did not start:', refused.message);
  });
});
