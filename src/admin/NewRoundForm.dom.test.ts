// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, fakeApi, find, render } from '../test/dom';
import { NewRoundForm } from './NewRoundForm';

const props = { rounds: [], onCreated: () => {} };
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

/** One keystroke's worth of input: the new value with the caret at `caret`, as a browser leaves it. */
async function key(input: HTMLInputElement, value: string, caret: number, composing = false) {
  await act(async () => {
    setValue?.call(input, value);
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
  });
}

const idField = (root: ParentNode) => root.querySelectorAll('input')[0] as HTMLInputElement;
const labelField = (root: ParentNode) => root.querySelectorAll('input')[1] as HTMLInputElement;

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NewRoundForm', () => {
  it('uppercases the round id as typed, keeping the caret where the letter went', async () => {
    const { container } = await render(NewRoundForm, props);
    const id = idField(container);
    await key(id, '2027-h1', 6);
    expect(id.value).toBe('2027-H1');
    expect([id.selectionStart, id.selectionEnd]).toEqual([6, 6]);
  });

  it('leaves an IME composition alone, and uppercases the id when the form is sent', async () => {
    const api = fakeApi({ 'POST /api/admin/rounds': [] });
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(NewRoundForm, props);
    const id = idField(container);
    await key(id, '2027-q1', 7, true);
    expect(id.value).toBe('2027-q1');
    await click(find(container, 'button', 'Open round'));
    expect(api.calls.at(-1)?.body).toMatchObject({ id: '2027-Q1' });
  });

  it('moves focus to a bad id, selected, invalid, and described by the message', async () => {
    const api = fakeApi({});
    vi.stubGlobal('fetch', api.fetchMock);
    const { container } = await render(NewRoundForm, props);
    const id = idField(container);
    await key(id, '27-Q1', 5);
    await click(find(container, 'button', 'Open round'));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Round ids look like 2027-Q1.');
    expect(api.calls).toHaveLength(0);
    expect(document.activeElement).toBe(id);
    expect([id.selectionStart, id.selectionEnd]).toEqual([0, 5]);
    expect(id.getAttribute('aria-invalid')).toBe('true');
    expect(id.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(labelField(container).getAttribute('aria-describedby')).toBe(alert?.id);
  });
});
