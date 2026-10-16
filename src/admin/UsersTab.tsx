import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { newPasswordProblem } from '../account/password-rules';
import type { AdminUser, Role, SessionUser } from '../domain/api-types';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { api, ApiError, errorMessage } from '../lib/api';
import { generatePassword } from './password';
import styles from './Admin.module.css';

type Editing = { id: number; kind: 'details' | 'password' };
type Save = (changes: Record<string, unknown>, done: string) => Promise<boolean>;

const SELF_ROLE = 'You cannot remove your own admin access. Ask another admin to make this change.';

const buttonKey = (id: number, action: Editing['kind'] | 'toggle') => `${id}:${action}`;

/** Your own row sends only the name: a role there is what the server's self rule refuses. */
export function detailsChanges(isMe: boolean, name: string, role: Role): Record<string, unknown> {
  return isMe ? { displayName: name } : { displayName: name, role };
}

/** The message for a failed change. A 403 means this account lost admin rights, so it also re-reads /me. */
export function failureMessage(reason: unknown, onForbidden: () => void): string {
  if (reason instanceof ApiError && reason.status === 403) onForbidden();
  return errorMessage(reason);
}

/** The server ends every session of the user, except the one you're using when it's your own row. */
export function passwordNotice(isMe: boolean, name: string, password: string): string {
  return isMe
    ? `Your new password is ${password}. You stay logged in here; your other sessions were ended.`
    : `New password for ${name}: ${password}. Share it privately. They are logged out everywhere and can change it after logging in.`;
}

interface UsersTabProps {
  users: readonly AdminUser[];
  me: SessionUser;
  onUsers: (users: AdminUser[]) => void;
  /** A 403 means this account is no longer an admin: re-reading /me sends it to /rate. */
  onForbidden: () => void;
}

export function UsersTab({ users, me, onUsers, onForbidden }: UsersTabProps) {
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useFocusIfLost<HTMLHeadingElement>();
  const results = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  /** The row button to focus after the next render, if focus fell to <body>. */
  const refocus = useRef<string | undefined>(undefined);

  // Closing an edit row removes the focused Save or Cancel, and a re-sorted list moves the focused row, which blurs it.
  useEffect(() => {
    const key = refocus.current;
    refocus.current = undefined;
    if (key && (!document.activeElement || document.activeElement === document.body)) buttons.current.get(key)?.focus();
  });

  const buttonRef = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(key, element);
    else buttons.current.delete(key);
  };

  const close = () => {
    if (editing) refocus.current = buttonKey(editing.id, editing.kind);
    setEditing(undefined);
  };

  const run = async (action: () => Promise<AdminUser[]>, done: string, focusAfter?: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      onUsers(await action());
      refocus.current = focusAfter;
      setEditing(undefined);
      setNotice(done);
      return true;
    } catch (reason) {
      setError(failureMessage(reason, onForbidden));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (user: AdminUser) => {
    if (
      user.active &&
      !confirm(`Disable ${user.displayName}? They are logged out everywhere and can't log in until you enable them.`)
    ) {
      return;
    }
    void run(
      () => api<AdminUser[]>('PUT', `/admin/users/${user.id}`, { active: !user.active }),
      `${user.displayName} is ${user.active ? 'disabled' : 'enabled'}.`,
      buttonKey(user.id, 'toggle'),
    );
  };

  // Mounted from the start, so a later notice is announced; the WakeNotice keeps the page's only role="status".
  return (
    <div className={styles.stack}>
      <div ref={results} aria-live="polite">
        {notice && (
          <p className={styles.panel} data-tone="success">
            {notice}
          </p>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.panel}>
        <h2 ref={heading} tabIndex={-1} className={styles.panelTitle}>
          Raters and admins
        </h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Login</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last scored</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) =>
              editing?.id === user.id ? (
                <EditUserRow
                  key={user.id}
                  user={user}
                  kind={editing.kind}
                  isMe={user.id === me.id}
                  busy={busy}
                  onCancel={close}
                  onSave={(changes, done) =>
                    run(
                      () => api<AdminUser[]>('PUT', `/admin/users/${user.id}`, changes),
                      done,
                      buttonKey(user.id, editing.kind),
                    )
                  }
                />
              ) : (
                <UserRow
                  key={user.id}
                  user={user}
                  isMe={user.id === me.id}
                  busy={busy}
                  buttonRef={buttonRef}
                  onEdit={(kind) => setEditing({ id: user.id, kind })}
                  onToggle={() => toggleActive(user)}
                />
              ),
            )}
          </tbody>
        </table>
      </section>
      <CreateUserForm
        busy={busy}
        onCreate={async (body, done) => {
          const ok = await run(() => api<AdminUser[]>('POST', '/admin/users', body), done);
          // The result, with the one-time password, shows above the table, where a long list pushes it off-screen.
          results.current?.scrollIntoView({ block: 'nearest' });
          return ok;
        }}
      />
    </div>
  );
}

interface UserRowProps {
  user: AdminUser;
  isMe: boolean;
  busy: boolean;
  /** Registers each action button, so focus can go back to it after its row is swapped or moved. */
  buttonRef: (key: string) => (element: HTMLButtonElement | null) => void;
  onEdit: (kind: Editing['kind']) => void;
  onToggle: () => void;
}

export function UserRow({ user, isMe, busy, buttonRef, onEdit, onToggle }: UserRowProps) {
  // aria-disabled, not disabled, while busy: a disabled button drops focus to <body>.
  return (
    <tr data-inactive={!user.active}>
      <td>
        {user.displayName}
        {isMe && <span className={styles.badge}>you</span>}
      </td>
      <td className={styles.code}>{user.login}</td>
      <td>{user.role === 'admin' ? 'Admin' : 'Rater'}</td>
      <td>{user.active ? 'Active' : 'Disabled'}</td>
      <td>{user.lastScoredRound ?? '—'}</td>
      <td>
        <div className={styles.rowActions}>
          <button
            ref={buttonRef(buttonKey(user.id, 'details'))}
            type="button"
            className={styles.small}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onEdit('details');
            }}
          >
            Edit
          </button>
          <button
            ref={buttonRef(buttonKey(user.id, 'password'))}
            type="button"
            className={styles.small}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onEdit('password');
            }}
          >
            Set password
          </button>
          {!isMe && (
            <button
              ref={buttonRef(buttonKey(user.id, 'toggle'))}
              type="button"
              className={styles.small}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) onToggle();
              }}
            >
              {user.active ? 'Disable' : 'Enable'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

interface EditUserRowProps {
  user: AdminUser;
  kind: Editing['kind'];
  /** Your own row: the server refuses to let you remove your own admin access, so the role stays locked. */
  isMe: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: Save;
}

export function EditUserRow({ user, kind, isMe, busy, onCancel, onSave }: EditUserRowProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState(generatePassword);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const problemId = useId();
  const hintId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (kind === 'password') {
      setAttempt((count) => count + 1);
      const weak = newPasswordProblem(password, password);
      if (weak) {
        setProblem(weak);
        return;
      }
      setProblem('');
      void onSave({ password }, passwordNotice(isMe, user.displayName, password));
    } else {
      const name = displayName.trim();
      void onSave(detailsChanges(isMe, name, role), `${name} is saved.`);
    }
  };

  // Password length comes from newPasswordProblem, in the server's words, not from minLength/maxLength: maxLength
  // silently truncates a pasted password, and the browser's own wording differs from the server's.
  return (
    <tr>
      <td colSpan={6}>
        <form className={styles.stack} onSubmit={submit}>
          <div className={styles.fields}>
            {kind === 'details' ? (
              <>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    required
                    autoFocus
                  />
                </label>
                <label className={styles.field}>
                  <span>Role</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                    disabled={isMe}
                    aria-describedby={isMe ? hintId : undefined}
                  >
                    <option value="rater">Rater</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span>New password for {user.displayName}</span>
                  <input
                    className={styles.code}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? problemId : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                </label>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setPassword(generatePassword());
                    setProblem('');
                  }}
                >
                  Generate another
                </button>
              </>
            )}
            <button type="submit" className={styles.primary} aria-disabled={busy}>
              Save
            </button>
            <button type="button" className={styles.secondary} onClick={onCancel}>
              Cancel
            </button>
          </div>
          {kind === 'details' && isMe && (
            <p id={hintId} className={styles.muted}>
              {SELF_ROLE}
            </p>
          )}
          {problem && (
            <p key={attempt} id={problemId} className={styles.error} role="alert">
              {problem}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

export function CreateUserForm({ busy, onCreate }: { busy: boolean; onCreate: Save }) {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('rater');
  const [password, setPassword] = useState(generatePassword);
  /** After a create the field stays empty, so it can't be mistaken for the password in the notice. */
  const [suggestOnNextLogin, setSuggestOnNextLogin] = useState(false);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const problemId = useId();

  // Lowercased in place, so React has nothing to write back and the caret stays put. Not mid-composition: writing the
  // value would cut an IME's pre-edit text short, so a composed login is lowercased when the composition ends.
  const takeLogin = (input: HTMLInputElement, composing: boolean) => {
    if (!composing) {
      const { selectionStart, selectionEnd } = input;
      input.value = input.value.toLowerCase();
      input.setSelectionRange(selectionStart, selectionEnd);
    }
    setLogin(input.value);
    if (suggestOnNextLogin && !password) setPassword(generatePassword());
    setSuggestOnNextLogin(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setAttempt((count) => count + 1);
    const weak = newPasswordProblem(password, password);
    if (weak) {
      setProblem(weak);
      return;
    }
    setProblem('');
    const name = displayName.trim();
    const loginName = login.trim().toLowerCase();
    const ok = await onCreate(
      { login: loginName, displayName: name, role, password },
      `${name} can log in at /rate as ${loginName} with the password ${password}. Share it privately; they can change it after logging in.`,
    );
    if (ok) {
      setLogin('');
      setDisplayName('');
      setRole('rater');
      setPassword('');
      setSuggestOnNextLogin(true);
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Add a rater or admin</h2>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Login</span>
          <input
            value={login}
            onChange={(event) => takeLogin(event.currentTarget, (event.nativeEvent as InputEvent).isComposing)}
            onCompositionEnd={(event) => takeLogin(event.currentTarget, false)}
            pattern="[a-z0-9][a-z0-9._\-]{1,39}"
            title="Logins use 2 to 40 lowercase letters, digits, dots, dashes, or underscores."
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
        </label>
        <label className={styles.field}>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="rater">Rater</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            className={styles.code}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            setPassword(generatePassword());
            setProblem('');
          }}
        >
          Generate another
        </button>
        <button type="submit" className={styles.primary} aria-disabled={busy}>
          Add user
        </button>
      </div>
      {problem && (
        <p key={attempt} id={problemId} className={styles.error} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
