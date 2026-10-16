import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { memoryStorage } from '../rating-ui/memory-storage';
import { logOutClearingDrafts, UNSAVED_ON_LOGOUT, type LogoutState } from './logout';

const WAKING = 'The ratings database is not responding. Try again in a minute.';
const clean = JSON.stringify({ base: { notebook: [5, 5, 5] }, draft: { notebook: [5, 5, 5] } });
const unsaved = JSON.stringify({ base: { notebook: [5, 5, 5] }, draft: { notebook: [6, 5, 5] } });

function setup(entries: Record<string, string>, logout: () => Promise<void> = async () => {}, answer = true) {
  const storage = memoryStorage(entries);
  vi.stubGlobal('localStorage', storage);
  const states: LogoutState[] = [];
  const ask = vi.fn(() => answer);
  const end = vi.fn(logout);
  return {
    run: () => logOutClearingDrafts(7, end, (state) => states.push(state), ask),
    keys: () => [...storage.items.keys()].sort(),
    states,
    ask,
    end,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logOutClearingDrafts', () => {
  it("logs out without asking when nothing is unsaved, then removes only this user's stored cards", async () => {
    const page = setup({ 'fcr-card:7:2026-Q4': clean, 'fcr-card:70:2026-Q4': unsaved, other: 'x' });
    await page.run();
    expect(page.ask).not.toHaveBeenCalled();
    expect(page.end).toHaveBeenCalledOnce();
    expect(page.keys()).toEqual(['fcr-card:70:2026-Q4', 'other']);
    expect(page.states).toEqual([{ kind: 'leaving' }, { kind: 'idle' }]);
  });

  it('asks first when there are unsaved scores; Cancel keeps the user logged in with the draft', async () => {
    const page = setup({ 'fcr-card:7:2026-Q4': unsaved }, undefined, false);
    await page.run();
    expect(page.ask).toHaveBeenCalledWith(UNSAVED_ON_LOGOUT);
    expect(page.end).not.toHaveBeenCalled();
    expect(page.keys()).toEqual(['fcr-card:7:2026-Q4']);
    expect(page.states).toEqual([]);
  });

  it('removes the unsaved scores once the user agrees and the session has ended', async () => {
    const page = setup({ 'fcr-card:7:2026-Q4': unsaved });
    await page.run();
    expect(page.ask).toHaveBeenCalledOnce();
    expect(page.end).toHaveBeenCalledOnce();
    expect(page.keys()).toEqual([]);
  });

  it('keeps the draft when the logout fails, since the user is still logged in', async () => {
    const page = setup({ 'fcr-card:7:2026-Q4': unsaved }, async () => {
      throw new ApiError(503, WAKING);
    });
    await page.run();
    expect(page.keys()).toEqual(['fcr-card:7:2026-Q4']);
    expect(page.states.at(-1)).toEqual({ kind: 'failed', message: `${WAKING} You are still logged in.` });
  });
});
