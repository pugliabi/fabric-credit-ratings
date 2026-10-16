import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminUser, SessionUser } from '../domain/api-types';
import { ApiError } from '../lib/api';
import {
  CreateUserForm,
  detailsChanges,
  EditUserRow,
  failureMessage,
  passwordNotice,
  UserRow,
  UsersTab,
} from './UsersTab';

const me: SessionUser = { id: 2, login: 'boss', displayName: 'Bea Admin', role: 'admin' };
const created = '2026-10-01T12:00:00.000Z';
const mine: AdminUser = { ...me, active: true, createdAt: created, lastScoredRound: '2026-Q4' };
const ann: AdminUser = {
  id: 9,
  login: 'ann',
  displayName: 'Ann Rater',
  role: 'rater',
  active: true,
  createdAt: created,
  lastScoredRound: null,
};
const gone: AdminUser = { ...ann, id: 12, login: 'gone', displayName: 'Gone Rater', active: false };
const noop = () => {};
const saved = async () => true;
const SELF_ROLE = 'You cannot remove your own admin access. Ask another admin to make this change.';

/** The markup of the table row whose login cell shows `login`. */
function row(html: string, login: string): string {
  const found = html.match(/<tr\b[\s\S]*?<\/tr>/g)?.find((tr) => tr.includes(`>${login}</td>`));
  expect(found, login).toBeDefined();
  return found!;
}

function inTable(element: ReactElement): string {
  return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, element)));
}

function editRow(user: AdminUser, kind: 'details' | 'password', busy = false): string {
  return inTable(
    createElement(EditUserRow, { user, kind, isMe: user.id === me.id, busy, onCancel: noop, onSave: saved }),
  );
}

function tag(html: string, name: string): string {
  const found = new RegExp(`<${name}\\b[^>]*>`).exec(html)?.[0];
  expect(found, name).toBeDefined();
  return found!;
}

/** Asserts the busy state is carried by aria-disabled alone: a disabled button drops focus to <body>. */
function expectAriaDisabledOnly(button: string | undefined, busy: boolean) {
  expect(button).toContain(`aria-disabled="${busy}"`);
  expect(button).not.toMatch(/\sdisabled[\s=>]/);
}

describe('UsersTab', () => {
  const html = renderToStaticMarkup(
    createElement(UsersTab, { users: [mine, ann, gone], me, onUsers: noop, onForbidden: () => false }),
  );

  it('gives the tab a heading that can take focus after login', () => {
    expect(html).toMatch(/<h2\b[^>]*tabindex="-1"[^>]*>Raters and admins<\/h2>/);
  });

  it('puts the table in a wrapper that scrolls sideways on a narrow screen', () => {
    expect(html).toMatch(/<div class="[^"]*tableWrap[^"]*"><table/);
  });

  it('marks your own row and offers no Disable there', () => {
    const own = row(html, 'boss');
    expect(own).toContain('>you</span>');
    expect(own).toContain('>Edit</button>');
    expect(own).toContain('>Set password</button>');
    expect(own).not.toMatch(/>(Disable|Enable)<\/button>/);
  });

  it('announces results in a live region that is there before any result, leaving role="status" to the WakeNotice', () => {
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/^<div[^>]*><div aria-live="polite"><\/div>/);
  });

  it('offers Disable for an active user, and Enable on a greyed-out row for a disabled one', () => {
    const active = row(html, 'ann');
    expect(active).toMatch(/^<tr[^>]*data-inactive="false"/);
    expect(active).toContain('>Disable</button>');
    const disabled = row(html, 'gone');
    expect(disabled).toMatch(/^<tr[^>]*data-inactive="true"/);
    expect(disabled).toContain('>Disabled</td>');
    expect(disabled).toContain('>Enable</button>');
  });
});

describe('UserRow', () => {
  const userRow = (busy: boolean) =>
    inTable(createElement(UserRow, { user: ann, isMe: false, busy, buttonRef: () => noop, onEdit: noop, onToggle: noop }));

  it('renders its buttons with aria-disabled, not disabled, while busy', () => {
    for (const busy of [false, true]) {
      const buttons = userRow(busy).match(/<button\b[^>]*>/g) ?? [];
      expect(buttons).toHaveLength(3);
      for (const button of buttons) expectAriaDisabledOnly(button, busy);
    }
  });
});

describe('EditUserRow', () => {
  it("locks the role on your own row and gives the server's reason", () => {
    const html = editRow(mine, 'details');
    const select = tag(html, 'select');
    expect(select).toMatch(/\sdisabled=""/);
    const hintId = /aria-describedby="([^"]+)"/.exec(select)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toContain(`id="${hintId}"`);
    expect(html).toContain(`>${SELF_ROLE}</p>`);
  });

  it("leaves another user's role open", () => {
    const html = editRow(ann, 'details');
    expect(tag(html, 'select')).not.toMatch(/\sdisabled|aria-describedby/);
    expect(html).not.toContain(SELF_ROLE);
  });

  it('renders Save with aria-disabled, not disabled, while busy', () => {
    for (const busy of [false, true]) {
      expectAriaDisabledOnly(/<button[^>]*>Save<\/button>/.exec(editRow(ann, 'password', busy))?.[0], busy);
    }
  });

  it("leaves password length to the server-worded check, so a paste isn't cut short", () => {
    const input = tag(editRow(ann, 'password'), 'input');
    expect(input).toMatch(/value="[a-hjkmnp-zA-HJ-NP-Z2-9]{16}"/);
    expect(input).not.toMatch(/minlength|maxlength|required|aria-invalid|aria-describedby/i);
  });
});

describe('CreateUserForm', () => {
  const render = (busy: boolean) => renderToStaticMarkup(createElement(CreateUserForm, { busy, onCreate: saved }));
  const html = render(false);
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];

  it("mirrors the server's login rule, in its words", () => {
    const login = inputs[0]!;
    expect(login).toContain('pattern="[a-z0-9][a-z0-9._\\-]{1,39}"');
    expect(login).toContain('title="Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores."');
    expect(login).toMatch(/autoCapitalize="none"/i);
  });

  it('renders Add user with aria-disabled, not disabled, while busy', () => {
    for (const busy of [false, true]) {
      expectAriaDisabledOnly(/<button[^>]*>Add user<\/button>/.exec(render(busy))?.[0], busy);
    }
  });

  it('suggests a password and leaves its length to the server-worded check', () => {
    expect(inputs).toHaveLength(3);
    const password = inputs[2]!;
    expect(password).toMatch(/value="[a-hjkmnp-zA-HJ-NP-Z2-9]{16}"/);
    expect(password).not.toMatch(/minlength|maxlength|required|aria-invalid|aria-describedby/i);
  });
});

describe('detailsChanges', () => {
  it('sends only the name for your own row', () => {
    expect(detailsChanges(true, 'Bea Admin', 'rater')).toEqual({ displayName: 'Bea Admin' });
    expect(detailsChanges(false, 'Ann Rater', 'admin')).toEqual({ displayName: 'Ann Rater', role: 'admin' });
  });
});

describe('failureMessage', () => {
  it('re-reads /me only on the 403 that means this account lost admin rights, and keeps the server text', () => {
    const calls: string[] = [];
    const forbidden = () => {
      calls.push('me');
      return true;
    };
    const origin = 'This request came from a page that is not allowed to change ratings.';
    expect(failureMessage(new ApiError(403, 'Only admins can do that.'), forbidden)).toBe('Only admins can do that.');
    expect(failureMessage(new ApiError(403, origin), forbidden)).toBe(origin);
    expect(failureMessage(new ApiError(409, SELF_ROLE), forbidden)).toBe(SELF_ROLE);
    expect(failureMessage(new ApiError(401, 'Log in to continue.'), forbidden)).toBe('Log in to continue.');
    expect(calls).toEqual(['me']);
  });
});

describe('passwordNotice', () => {
  it("says every session of someone else ended, and that yours here stays", () => {
    expect(passwordNotice(false, 'Ann Rater', 'abcdefghjk23')).toBe(
      'New password for Ann Rater: abcdefghjk23. Share it privately. They are logged out everywhere and can change it after logging in.',
    );
    expect(passwordNotice(true, 'Bea Admin', 'abcdefghjk23')).toBe(
      'Your new password is abcdefghjk23. You stay logged in here; your other sessions were ended.',
    );
  });
});
