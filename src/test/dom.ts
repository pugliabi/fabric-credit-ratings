// Helpers for the few tests that need a DOM (files starting with `// @vitest-environment happy-dom`).
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<() => Promise<void>>();

export async function render<P extends object>(component: ComponentType<P>, props: P) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(component, props)));
  const unmount = async () => {
    if (!mounted.delete(unmount)) return;
    await act(async () => root.unmount());
    container.remove();
  };
  mounted.add(unmount);
  return { container, unmount };
}

/** Unmounts everything render() mounted, so effects (listeners, unsaved-work holds) don't leak into the next test. */
export async function cleanup(): Promise<void> {
  for (const unmount of [...mounted]) await unmount();
}

/** Lets pending promises and the effects they cause settle. */
export const settle = () => act(async () => {});

/** Sets a control's value the way typing does, so React's onChange sees it. */
export async function type(element: Element | null, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error('not a text control');
  }
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function choose(element: Element | null, value: string): Promise<void> {
  if (!(element instanceof HTMLSelectElement)) throw new Error('not a select');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  await act(async () => element.click());
}

/** The first `selector` match whose text is `text` (trimmed). */
export function find(root: ParentNode, selector: string, text: string | RegExp): HTMLElement | null {
  const matches = (value: string) => (typeof text === 'string' ? value === text : text.test(value));
  const nodes = [...root.querySelectorAll<HTMLElement>(selector)];
  return nodes.find((node) => matches(node.textContent?.trim() ?? '')) ?? null;
}

/** Answers fetch from `routes` ("METHOD /api/path" → body, or a function), recording each call. */
export function fakeApi(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      return new Response(JSON.stringify({ error: `no fake for ${method} ${path}` }), { status: 500 });
    }
    const answer = typeof route === 'function' ? await route(body) : route;
    if (answer instanceof Response) return answer;
    return new Response(answer === null ? '' : JSON.stringify(answer), { status: answer === null ? 204 : 200 });
  };
  return { fetchMock, calls };
}
