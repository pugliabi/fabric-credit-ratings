import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdUnsaved, LEAVE_UNSAVED, mayLeave } from './useUnsavedWork';

const releases: (() => void)[] = [];
const hold = () => {
  const release = holdUnsaved();
  releases.push(release);
  return release;
};

afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe('mayLeave', () => {
  it('lets the page move on without asking when nothing is unsaved', () => {
    const ask = vi.fn(() => false);
    expect(mayLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once while anything is unsaved, and goes by the answer', () => {
    hold();
    hold();
    const ask = vi.fn(() => false);
    expect(mayLeave(ask)).toBe(false);
    expect(ask).toHaveBeenCalledExactlyOnceWith(LEAVE_UNSAVED);
    expect(mayLeave(() => true)).toBe(true);
  });

  it('stops asking once every hold is released', () => {
    const first = hold();
    const second = hold();
    first();
    expect(mayLeave(() => false)).toBe(false);
    second();
    expect(mayLeave(() => false)).toBe(true);
  });
});
