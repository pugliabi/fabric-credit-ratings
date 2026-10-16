import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminUser, SessionUser } from '../domain/api-types';
import { CreateUserForm, EditUserRow, UsersTab } from './UsersTab';

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

function editRow(user: AdminUser, kind: 'details' | 'password'): string {
  return inTable(
    createElement(EditUserRow, { user, kind, isMe: user.id === me.id, busy: false, onCancel: noop, onSave: saved }),
  );
}

function tag(html: string, name: string): string {
  const found = new RegExp(`<${name}\\b[^>]*>`).exec(html)?.[0];
  expect(found, name).toBeDefined();
  return found!;
}

describe('UsersTab', () => {
  const html = renderToStaticMarkup(
    createElement(UsersTab, { users: [mine, ann, gone], me, onUsers: noop, onForbidden: noop }),
  );

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

  it('keeps the row buttons focusable, so focus survives an action', () => {
    const buttons = row(html, 'ann').match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain('aria-disabled="false"');
      expect(button).not.toMatch(/\sdisabled[\s=>]/);
    }
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

  it('keeps Save focusable, so focus survives a failed save', () => {
    const save = /<button[^>]*>Save<\/button>/.exec(editRow(ann, 'password'))?.[0];
    expect(save).toContain('aria-disabled="false"');
    expect(save).not.toMatch(/\sdisabled[\s=>]/);
  });

  it("leaves password length to the server-worded check, so a paste isn't cut short", () => {
    const input = tag(editRow(ann, 'password'), 'input');
    expect(input).toMatch(/value="[a-hjkmnp-zA-HJ-NP-Z2-9]{16}"/);
    expect(input).not.toMatch(/minlength|maxlength|required|aria-invalid|aria-describedby/i);
  });
});

describe('CreateUserForm', () => {
  const html = renderToStaticMarkup(createElement(CreateUserForm, { busy: false, onCreate: saved }));
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];

  it("mirrors the server's login rule, in its words", () => {
    const login = inputs[0]!;
    expect(login).toContain('pattern="[a-z0-9][a-z0-9._\\-]{1,39}"');
    expect(login).toContain('title="Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores."');
    expect(login).toMatch(/autoCapitalize="none"/i);
  });

  it('keeps Add user focusable, so focus survives a failed create', () => {
    const add = /<button[^>]*>Add user<\/button>/.exec(html)?.[0];
    expect(add).toContain('aria-disabled="false"');
    expect(add).not.toMatch(/\sdisabled[\s=>]/);
  });

  it('suggests a password and leaves its length to the server-worded check', () => {
    expect(inputs).toHaveLength(3);
    const password = inputs[2]!;
    expect(password).toMatch(/value="[a-hjkmnp-zA-HJ-NP-Z2-9]{16}"/);
    expect(password).not.toMatch(/minlength|maxlength|required|aria-invalid|aria-describedby/i);
  });
});
