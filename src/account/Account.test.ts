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
const login = async () => {};

describe('LoginForm', () => {
  it('shows a notice above the fields only when there is one', () => {
    const notice = 'Your session ended. Log in again; unsaved scores are still in this browser.';
    const withNotice = renderToStaticMarkup(
      createElement(LoginForm, { title: 'Log in to score', notice, onLogin: login }),
    );
    expect(withNotice).toContain('Log in to score');
    expect(withNotice.indexOf(notice)).toBeGreaterThan(-1);
    expect(withNotice.indexOf(notice)).toBeLessThan(withNotice.indexOf('<input'));
    const without = renderToStaticMarkup(
      createElement(LoginForm, { title: 'Admin login', notice: '', onLogin: login }),
    );
    expect(without.match(/<p\b/g)).toHaveLength(withNotice.match(/<p\b/g)!.length - 1);
    expect(without).not.toContain('role="alert"');
  });

  it('lets password managers fill both fields', () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { title: 'Admin login', onLogin: login }));
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toMatch(/type="password"[^>]*autocomplete="current-password"/i);
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
    const html = renderToStaticMarkup(createElement(AccountBar, { user: rater, onLogout: noop }));
    expect(html).toContain('Ann Rater');
    expect(html).toContain('Change password');
    expect(html).toContain('Log out');
    expect(html).not.toContain('<dialog');
  });

  it('links to /admin only for admins, and only where asked', () => {
    const bar = (user: SessionUser, adminLink: boolean) =>
      renderToStaticMarkup(createElement(AccountBar, { user, onLogout: noop, adminLink }));
    expect(bar(admin, true)).toContain('href="/admin"');
    expect(bar(admin, false)).not.toContain('href="/admin"');
    expect(bar(rater, true)).not.toContain('href="/admin"');
  });
});

describe('ChangePasswordDialog', () => {
  it("states the server's minimum length and caps the new password at its maximum", () => {
    const html = renderToStaticMarkup(createElement(ChangePasswordDialog, { onClose: noop }));
    expect(html).toContain('New password (10 or more characters)');
    expect(html).toMatch(/minlength="10"/i);
    expect(html).toMatch(/maxlength="200"/i);
  });

  it('renders without the open attribute, so its effect can open it as a modal', () => {
    const html = renderToStaticMarkup(createElement(ChangePasswordDialog, { onClose: noop }));
    expect(html).toMatch(/^<dialog\b[^>]*>/);
    expect(html).not.toMatch(/^<dialog\b[^>]*\bopen\b/);
  });
});

describe('WakeNotice', () => {
  it('renders nothing until a request is slow', () => {
    expect(renderToStaticMarkup(createElement(WakeNotice))).toBe('');
  });
});
