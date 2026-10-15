import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../domain/dataset.ts';
import { db } from '../lib/db.ts';
import type { UserCtx } from '../lib/http.ts';
import { loadDataset } from '../repo/dataset.ts';
import { markSnapshotTaken } from '../repo/site.ts';
import './build.ts';

type Handler = (ctx: UserCtx) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock(import('../lib/http.ts'), () => ({
  route: (name: string, _method: string, _path: string, _access: string, handler: Handler) => {
    handlers.set(name, handler);
  },
}));
vi.mock(import('../lib/db.ts'), async (importOriginal) => ({ ...(await importOriginal()), db: { query: vi.fn() } }));
vi.mock(import('../repo/dataset.ts'), () => ({ loadDataset: vi.fn() }));
vi.mock(import('../repo/site.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  markSnapshotTaken: vi.fn(),
}));

const empty: Dataset = { workloads: [], artifacts: [], rounds: [], raterNames: new Map() };

function call(name: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered.`);
  return handler({ body } as unknown as UserCtx);
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const notIso =
  'generatedAt must be an ISO timestamp exactly as the snapshot gave it, such as 2026-10-15T21:00:00.000Z.';
const future =
  'generatedAt is more than 5 minutes in the future. Send the generatedAt of the snapshot that was deployed.';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDataset).mockResolvedValue(empty);
});

describe('GET build/snapshot', () => {
  const lockedClock = 'SELECT SYSUTCDATETIME() AS now FROM site_state WITH (READCOMMITTEDLOCK) WHERE id = 1';

  it("dates the snapshot by the database's clock, read under site_state's lock before loading, and writes nothing", async () => {
    const now = new Date('2026-10-15T21:00:00.123Z');
    vi.mocked(db.query).mockResolvedValue([{ now }]);

    const snapshot = await call('buildSnapshot');

    expect(snapshot).toMatchObject({ generatedAt: now.toISOString() });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(lockedClock);
    const [clock = 0] = vi.mocked(db.query).mock.invocationCallOrder;
    const [load = 0] = vi.mocked(loadDataset).mock.invocationCallOrder;
    expect(clock).toBeLessThan(load);
    expect(markSnapshotTaken).not.toHaveBeenCalled();
  });

  it('falls back to the plain clock, still before loading, when the site_state row is missing', async () => {
    const now = new Date('2026-10-15T21:00:00.123Z');
    vi.mocked(db.query).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now }]);

    const snapshot = await call('buildSnapshot');

    expect(snapshot).toMatchObject({ generatedAt: now.toISOString() });
    expect(vi.mocked(db.query).mock.calls).toEqual([[lockedClock], ['SELECT SYSUTCDATETIME() AS now']]);
    const [, fallback = 0] = vi.mocked(db.query).mock.invocationCallOrder;
    const [load = 0] = vi.mocked(loadDataset).mock.invocationCallOrder;
    expect(fallback).toBeLessThan(load);
  });
});

describe('POST build/snapshot/deployed', () => {
  it('stamps the deployed snapshot time and answers with no body', async () => {
    const generatedAt = minutesFromNow(-1);
    expect(await call('buildSnapshotDeployed', { generatedAt })).toBeUndefined();
    expect(markSnapshotTaken).toHaveBeenCalledWith(db, new Date(generatedAt));
  });

  it("accepts a time up to 5 minutes ahead of this host's clock", async () => {
    const generatedAt = minutesFromNow(4);
    await call('buildSnapshotDeployed', { generatedAt });
    expect(markSnapshotTaken).toHaveBeenCalledWith(db, new Date(generatedAt));
  });

  it('refuses a missing generatedAt', async () => {
    for (const generatedAt of [undefined, 1_760_562_000_000, null]) {
      await expect(call('buildSnapshotDeployed', { generatedAt })).rejects.toMatchObject({
        status: 400,
        message: 'generatedAt is required: send the generatedAt of the snapshot that was deployed.',
      });
    }
    expect(markSnapshotTaken).not.toHaveBeenCalled();
  });

  it('refuses anything that is not an ISO timestamp exactly as the snapshot gives it', async () => {
    const malformed = [
      '',
      'yesterday',
      '2026-10-15',
      '2026-10-15T21:00:00Z',
      '2026-10-15T21:00:00.000+00:00',
      '2026-02-31T00:00:00.000Z',
    ];
    for (const generatedAt of malformed) {
      await expect(call('buildSnapshotDeployed', { generatedAt })).rejects.toMatchObject({
        status: 400,
        message: notIso,
      });
    }
    expect(markSnapshotTaken).not.toHaveBeenCalled();
  });

  it('refuses a time more than 5 minutes in the future', async () => {
    await expect(call('buildSnapshotDeployed', { generatedAt: minutesFromNow(6) })).rejects.toMatchObject({
      status: 400,
      message: future,
    });
    expect(markSnapshotTaken).not.toHaveBeenCalled();
  });
});
