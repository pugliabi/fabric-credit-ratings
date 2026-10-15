import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../domain/api-types';
import { AccountBar } from './AccountBar';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { LoginForm } from './LoginForm';
import { Unavailable } from './Unavailable';
import { WakeNotice } from './WakeNotice';

const rater: SessionUser = { id: 2, login: 'ann', displayName: 'Ann Rater', role: 'rater' };
const admin: SessionUser = { id: 1, login: 'boss', displayName: 'Bea Admin', role: 'admin' };
const noop = () => {};
const resolved = async () => {};

/** Each <input> tag's attributes, since React's server renderer puts name and value last. */
function inputs(html: string): Record<string, string>[] {
  return (html.match(/<input[^>]*>/g) ?? []).map((tag) =>
    Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name!.toLowerCase(), value!])),
  );
}

describe('LoginForm', () => {
  it('announces a notice above the fields only when there is one', () => {
    const notice = 'Your session ended. Log in again; unsaved scores are still in this browser.';
    const withNotice = renderToStaticMarkup(
      createElement(LoginForm, { title: 'Log in to score', notice, onLogin: resolved }),
    );
    expect(withNotice).toContain('Log in to score');
    expect(withNotice).toMatch(new RegExp(`<p[^>]*role="alert"[^>]*>${notice}</p>`));
    expect(withNotice.indexOf(notice)).toBeLessThan(withNotice.indexOf('<input'));
    const without = renderToStaticMarkup(
      createElement(LoginForm, { title: 'Admin login', notice: '', onLogin: resolved }),
    );
    expect(without.match(/<p\b/g)).toHaveLength(withNotice.match(/<p\b/g)!.length - 1);
    expect(without).not.toContain('role="alert"');
  });

  it('names both fields for password managers and ties nothing to an error before there is one', () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { title: 'Admin login', onLogin: resolved }));
    expect(inputs(html)).toEqual([
      expect.objectContaining({ name: 'username', autocomplete: 'username' }),
      expect.objectContaining({ type: 'password', name: 'password', autocomplete: 'current-password' }),
    ]);
    expect(html).not.toMatch(/aria-describedby/i);
    expect(html).not.toMatch(/<button[^>]*\sdisabled/i);
  });
});

describe('Unavailable', () => {
  it('shows the reason and a retry button as an alert', () => {
    const message = 'The ratings database is not responding. Try again in a minute.';
    const html = renderToStaticMarkup(createElement(Unavailable, { message, onRetry: noop }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
    expect(html).toContain('Try again');
  });
});

describe('AccountBar', () => {
  it('names the user and offers password change and log out, without opening the dialog', () => {
    const html = renderToStaticMarkup(createElement(AccountBar, { user: rater, onLogout: resolved }));
    expect(html).toContain('Ann Rater');
    expect(html).toContain('Change password');
    expect(html).toContain('>Log out</button>');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('role="alert"');
  });

  it('links to /admin only for admins, and only where asked', () => {
    const bar = (user: SessionUser, adminLink: boolean) =>
      renderToStaticMarkup(createElement(AccountBar, { user, onLogout: resolved, adminLink }));
    expect(bar(admin, true)).toContain('href="/admin"');
    expect(bar(admin, false)).not.toContain('href="/admin"');
    expect(bar(rater, true)).not.toContain('href="/admin"');
  });
});

describe('ChangePasswordDialog', () => {
  const dialog = () => renderToStaticMarkup(createElement(ChangePasswordDialog, { login: 'ann', onClose: noop }));

  it('leaves length rules to the server-worded check instead of the browser', () => {
    const html = dialog();
    expect(html).toContain('New password (10 or more characters)');
    expect(html).not.toMatch(/minlength|maxlength/i);
    expect(inputs(html).filter((input) => 'required' in input)).toEqual([
      expect.objectContaining({ autocomplete: 'current-password' }),
    ]);
  });

  it('is named by its heading and tells password managers whose password changes', () => {
    const html = dialog();
    const labelledBy = /^<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}"`);
    expect(inputs(html)[0]).toEqual({ type: 'text', autocomplete: 'username', readonly: '', hidden: '', value: 'ann' });
  });

  it('renders without the open attribute, so its effect can open it as a modal', () => {
    const html = dialog();
    expect(html).toMatch(/^<dialog\b[^>]*>/);
    expect(html).not.toMatch(/^<dialog\b[^>]*\bopen\b/);
  });
});

describe('WakeNotice', () => {
  it('keeps an empty live region until a request is slow', () => {
    expect(renderToStaticMarkup(createElement(WakeNotice))).toMatch(/^<p[^>]*role="status"[^>]*><\/p>$/);
  });
});
