import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdUnsaved } from '../hooks/useUnsavedWork';
import { ApiError } from '../lib/api';
import { memoryStorage } from '../rating-ui/memory-storage';
import {
  logOutClearingDrafts,
  UNSAVED_BOTH_ON_LOGOUT,
  UNSAVED_ON_LOGOUT,
  UNSAVED_WORK_ON_LOGOUT,
  type LogoutState,
} from './logout';

const WAKING = 'The ratings database is not responding. Try again in a minute.';
const clean = JSON.stringify({ base: { notebook: [5, 5, 5] }, draft: { notebook: [5, 5, 5] } });
const unsaved = JSON.stringify({ base: { notebook: [5, 5, 5] }, draft: { notebook: [6, 5, 5] } });

function setup(
  entries: Record<string, string>,
  logout: () => Promise<void> = async () => {},
  answer = true,
  known?: ReadonlySet<string>,
) {
  const storage = memoryStorage(entries);
  vi.stubGlobal('localStorage', storage);
  const states: LogoutState[] = [];
  const ask = vi.fn(() => answer);
  const end = vi.fn(logout);
  return {
    run: () => logOutClearingDrafts(7, end, (state) => states.push(state), ask, known),
    keys: () => [...storage.items.keys()].sort(),
    states,
    ask,
    end,
  };
}

let release = () => {};

afterEach(() => {
  release();
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

  it('asks nothing for an edit on an item deleted since, when it knows the current catalog', async () => {
    const deletedOnly = JSON.stringify({
      base: { notebook: [5, 5, 5] },
      draft: { notebook: [5, 5, 5], gone: [6, 5, 5] },
    });
    const page = setup({ 'fcr-card:7:2026-Q4': deletedOnly }, undefined, false, new Set(['notebook']));
    await page.run();
    expect(page.ask).not.toHaveBeenCalled();
    expect(page.end).toHaveBeenCalledOnce();
    expect(page.keys()).toEqual([]);
  });

  it('asks before unsaved whys or card edits on the page are lost; Cancel keeps the user logged in', async () => {
    release = holdUnsaved();
    const page = setup({}, undefined, false);
    await page.run();
    expect(page.ask).toHaveBeenCalledExactlyOnceWith(UNSAVED_WORK_ON_LOGOUT);
    expect(page.end).not.toHaveBeenCalled();
  });

  it('asks once, about both, when stored scores and unsaved page work would go', async () => {
    release = holdUnsaved();
    const page = setup({ 'fcr-card:7:2026-Q4': unsaved });
    await page.run();
    expect(page.ask).toHaveBeenCalledExactlyOnceWith(UNSAVED_BOTH_ON_LOGOUT);
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
