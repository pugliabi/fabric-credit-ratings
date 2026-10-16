import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../domain/api-types';
import { FACTORS } from '../data/factors';
import type { ReleaseStatus } from '../domain/types';
import { naFactorsOf } from '../domain/factors-applicable';
import { useFocusIfLost } from '../hooks/useFocusIfLost';
import { deleteFocus, focusKeys as keys, focusLost, moveFocus, pickFocus } from './catalog-focus';
import { followServer, slugify, workloadBody, type ArtifactChanges, type WorkloadFields } from './catalog-order';
import { catalogActions as actions, createCatalogWrites } from './catalog-write';
import styles from './Admin.module.css';

/** The server's limit on an item description, for the counter. The server refuses anything longer. */
const DESCRIPTION_MAX = 600;

/** The item table's columns, which an editor row spans. */
const ITEM_COLUMNS = 6;

const STATUSES: { id: ReleaseStatus; label: string }[] = [
  { id: 'ga', label: 'GA' },
  { id: 'preview', label: 'Preview' },
  { id: 'retired', label: 'Retired' },
];

/**
 * Runs one catalog write at a time (resolves false on failure, or at once while another runs). `focusAfter` lists the
 * controls to put focus back on, in order, if the write leaves it on <body>.
 */
export type Run = (action: () => Promise<AdminCatalog>, focusAfter: readonly string[]) => Promise<boolean>;

/** A ref that registers an element under `key` (catalog-focus.ts focusKeys) as a place focus can return to. */
export type Control = (key: string) => (element: HTMLElement | null) => void;

interface CatalogTabProps {
  catalog: AdminCatalog;
  onCatalog: (catalog: AdminCatalog) => void;
}

// Ids, names, and lengths are checked by the server, whose 400s are shown as is (no pattern or maxLength here).
export function CatalogTab({ catalog, onCatalog }: CatalogTabProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // The write runner outlives renders, so it reaches the latest onCatalog through this ref; it needn't be stable.
  const latest = useRef(onCatalog);
  useEffect(() => {
    latest.current = onCatalog;
  });
  const [writes] = useState(() =>
    createCatalogWrites({
      onCatalog: (fresh) => latest.current(fresh),
      onError: setError,
      onStart: () => {
        setBusy(true);
        setError('');
        setAttempt((count) => count + 1);
      },
      onSettled: () => setBusy(false),
    }),
  );
  const controls = useRef(new Map<string, HTMLElement>());
  const refocus = useRef<readonly string[]>([]);
  /** Where the last write started, for Dismiss. */
  const lastFocus = useRef<readonly string[]>([]);
  const heading = useFocusIfLost<HTMLHeadingElement>();

  useEffect(() => {
    const controller = new AbortController();
    void writes.readOnOpen(controller.signal);
    return () => controller.abort();
  }, [writes]);

  // A select that turned disabled, a row React moved (moving a node blurs it), or a removed row drops focus. Once the
  // write settles, put it on the same control or its stand-in, unless the user has moved on.
  useEffect(() => {
    if (busy || refocus.current.length === 0) return;
    const targets = refocus.current;
    refocus.current = [];
    if (focusLost(document.activeElement, document.body)) {
      pickFocus(targets, (key) => controls.current.get(key))?.focus();
    }
  });

  const control: Control = (key) => (element) => {
    if (element) controls.current.set(key, element);
    else controls.current.delete(key);
  };

  const run: Run = (action, focusAfter) => {
    if (writes.running) return Promise.resolve(false);
    refocus.current = lastFocus.current = focusAfter;
    return writes.run(action);
  };

  const dismiss = () => {
    refocus.current = [...lastFocus.current, keys.heading];
    setError('');
  };

  return (
    <div className={styles.stack}>
      <h2
        ref={(element) => {
          heading.current = element;
          control(keys.heading)(element);
        }}
        tabIndex={-1}
        className={styles.panelTitle}
      >
        Workloads and items
      </h2>
      <p className={styles.hint}>
        Raters see catalog changes right away; the public site gets them at the next site update. Items with scores or
        notes can't be deleted. Mark them retired instead.
      </p>
      {/* Sticky, so a refusal from a form far down the page is still in view. */}
      {error && (
        <div className={styles.toolbar}>
          <p key={attempt} className={styles.error} role="alert">
            {error}
          </p>
          <button type="button" className={styles.small} onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {catalog.workloads.map((workload, index) => (
        <WorkloadBlock
          key={workload.id}
          workload={workload}
          catalog={catalog}
          busy={busy}
          run={run}
          control={control}
          canMoveUp={index > 0}
          canMoveDown={index < catalog.workloads.length - 1}
          onMove={(step) =>
            void run(actions.moveWorkloads(catalog, index, index + step), moveFocus(`workload:${workload.id}`, step))
          }
        />
      ))}
      <AddWorkloadForm busy={busy} run={run} control={control} />
    </div>
  );
}

interface MoveProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (step: number) => void;
}

interface WriteProps {
  busy: boolean;
  run: Run;
  control: Control;
}

interface WorkloadBlockProps extends MoveProps, WriteProps {
  workload: AdminWorkload;
  catalog: AdminCatalog;
}

function WorkloadBlock({ workload, catalog, busy, run, control, canMoveUp, canMoveDown, onMove }: WorkloadBlockProps) {
  const server = workloadBody(workload);
  const [fields, setFields] = useState(server);
  const [shown, setShown] = useState(server);
  // A change made elsewhere replaces an untouched field instead of offering to undo it.
  if (server.name !== shown.name || server.shortName !== shown.shortName || server.blurb !== shown.blurb) {
    setShown(server);
    setFields((current) => ({
      name: followServer(current.name, shown.name, server.name),
      shortName: followServer(current.shortName, shown.shortName, server.shortName),
      blurb: followServer(current.blurb, shown.blurb, server.blurb),
    }));
  }
  const items = catalog.artifacts.filter((artifact) => artifact.workload === workload.id);
  const ids = items.map((artifact) => artifact.id);
  // The server trims, so compare trimmed values: Save would otherwise stay after saving "Name ".
  const changed =
    fields.name.trim() !== workload.name ||
    fields.shortName.trim() !== workload.shortName ||
    fields.blurb.trim() !== workload.blurb;
  const edit = (changes: Partial<WorkloadFields>) => setFields({ ...fields, ...changes });

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(actions.saveWorkload(workload, fields), [keys.workloadName(workload.id)]);
  };

  return (
    <section className={styles.panel}>
      <h3 ref={control(keys.section(workload.id))} tabIndex={-1} className={styles.groupTitle}>
        {workload.name}
      </h3>
      <form className={styles.workloadForm} onSubmit={save}>
        <label className={styles.field}>
          <span>Workload</span>
          <input
            ref={control(keys.workloadName(workload.id))}
            value={fields.name}
            onChange={(event) => edit({ name: event.target.value })}
            aria-label={`${workload.name} workload name`}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Short name</span>
          <input
            value={fields.shortName}
            onChange={(event) => edit({ shortName: event.target.value })}
            aria-label={`${workload.name} short name`}
            required
          />
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Description</span>
          <input
            value={fields.blurb}
            onChange={(event) => edit({ blurb: event.target.value })}
            aria-label={`${workload.name} description`}
            required
          />
        </label>
        <div className={styles.rowActions}>
          {changed && (
            <button type="submit" className={styles.primary} aria-disabled={busy} aria-label={`Save ${workload.name}`}>
              Save
            </button>
          )}
          <MoveButtons
            scope={`workload:${workload.id}`}
            name={workload.name}
            busy={busy}
            control={control}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
        </div>
      </form>
      {items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Id</th>
                <th>Status</th>
                <th>Workload</th>
                <th>Not applicable</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((artifact, index) => (
                <ArtifactRowEditor
                  key={artifact.id}
                  artifact={artifact}
                  catalog={catalog}
                  busy={busy}
                  run={run}
                  control={control}
                  afterDelete={deleteFocus(ids, index, workload.id)}
                  canMoveUp={index > 0}
                  canMoveDown={index < items.length - 1}
                  onMove={(step) =>
                    void run(
                      actions.moveArtifacts(catalog, workload.id, index, index + step),
                      moveFocus(`item:${artifact.id}`, step),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddArtifactForm workload={workload} busy={busy} run={run} control={control} />
    </section>
  );
}

interface MoveButtonsProps extends MoveProps {
  /** `item:<id>` or `workload:<id>`, for focusKeys.arrow. */
  scope: string;
  name: string;
  busy: boolean;
  control: Control;
}

function MoveButtons({ scope, name, busy, control, canMoveUp, canMoveDown, onMove }: MoveButtonsProps) {
  // aria-disabled, not disabled, while busy: a disabled button drops focus to <body>. The ends stay disabled.
  return (
    <>
      <button
        ref={control(keys.arrow(scope, 'up'))}
        type="button"
        className={styles.small}
        onClick={() => {
          if (!busy) onMove(-1);
        }}
        disabled={!canMoveUp}
        aria-disabled={busy}
        aria-label={`Move ${name} up`}
      >
        ↑
      </button>
      <button
        ref={control(keys.arrow(scope, 'down'))}
        type="button"
        className={styles.small}
        onClick={() => {
          if (!busy) onMove(1);
        }}
        disabled={!canMoveDown}
        aria-disabled={busy}
        aria-label={`Move ${name} down`}
      >
        ↓
      </button>
    </>
  );
}

interface ArtifactRowEditorProps extends MoveProps, WriteProps {
  artifact: AdminArtifact;
  /** The whole catalog: the module picks the rows a move to another workload is measured against. */
  catalog: AdminCatalog;
  /** Where focus goes if a delete removes this row (catalog-focus.ts deleteFocus). */
  afterDelete: readonly string[];
}

export function ArtifactRowEditor({
  artifact,
  catalog,
  busy,
  run,
  control,
  afterDelete,
  canMoveUp,
  canMoveDown,
  onMove,
}: ArtifactRowEditorProps) {
  const [name, setName] = useState(artifact.name);
  const [shown, setShown] = useState(artifact.name);
  // A rename made elsewhere replaces an untouched field instead of offering to undo it.
  if (artifact.name !== shown) {
    setShown(artifact.name);
    setName((current) => followServer(current, shown, artifact.name));
  }

  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState(artifact.description);
  const [shownDescription, setShownDescription] = useState(artifact.description);
  // A description saved elsewhere replaces an untouched text instead of offering to undo it.
  if (artifact.description !== shownDescription) {
    setShownDescription(artifact.description);
    setDescription((current) => followServer(current, shownDescription, artifact.description));
  }
  // The server trims, so compare trimmed values: Save would otherwise stay after saving "Text ".
  const descriptionLength = description.trim().length;
  const descriptionChanged = description.trim() !== artifact.description;

  const update = (changes: ArtifactChanges, focusAfter: readonly string[]) =>
    void run(actions.updateArtifact(artifact, changes, catalog), focusAfter);

  const saveDescription = () => {
    if (busy || !descriptionChanged) return;
    void run(actions.saveDescription(artifact, description), [
      keys.descriptionText(artifact.id),
      keys.description(artifact.id),
    ]);
  };

  const remove = () => {
    if (busy) return;
    if (confirm(`Delete ${artifact.name}? This cannot be undone.`)) {
      void run(actions.deleteArtifact(artifact), afterDelete);
    }
  };

  return (
    <>
      <tr>
        <td>
          <form
            className={styles.inline}
            onSubmit={(event) => {
              event.preventDefault();
              update({ name: name.trim() }, [keys.name(artifact.id)]);
            }}
          >
            <input
              ref={control(keys.name(artifact.id))}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={`${artifact.name} name`}
              required
            />
            {name.trim() !== artifact.name && (
              <button
                type="submit"
                className={styles.small}
                aria-disabled={busy}
                aria-label={`Save ${artifact.name} name`}
              >
                Save
              </button>
            )}
          </form>
        </td>
        <td className={styles.code}>{artifact.id}</td>
        <td>
          <select
            ref={control(keys.status(artifact.id))}
            value={artifact.status}
            onChange={(event) => update({ status: event.target.value as ReleaseStatus }, [keys.status(artifact.id)])}
            disabled={busy}
            aria-label={`${artifact.name} status`}
          >
            {STATUSES.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            ref={control(keys.place(artifact.id))}
            value={artifact.workload}
            onChange={(event) => update({ workload: event.target.value }, [keys.place(artifact.id)])}
            disabled={busy}
            aria-label={`${artifact.name} workload`}
          >
            {catalog.workloads.map((workload) => (
              <option key={workload.id} value={workload.id}>
                {workload.shortName}
              </option>
            ))}
          </select>
        </td>
        <td>
          <fieldset className={styles.naFactors} disabled={busy}>
            <legend className="visually-hidden">{`${artifact.name} not applicable`}</legend>
            {FACTORS.map((factor) => (
              <label key={factor.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={naFactorsOf(artifact).includes(factor.id)}
                  onChange={(event) => {
                    const next = FACTORS.map((f) => f.id).filter((id) =>
                      id === factor.id ? event.target.checked : naFactorsOf(artifact).includes(id),
                    );
                    if (next.length >= FACTORS.length) return;
                    update({ naFactors: next }, [keys.na(artifact.id, factor.id)]);
                  }}
                  ref={control(keys.na(artifact.id, factor.id))}
                  aria-label={`${artifact.name}: ${factor.label} not applicable`}
                />
                {factor.label}
              </label>
            ))}
          </fieldset>
        </td>
        <td>
          <div className={styles.rowActions}>
            <button
              ref={control(keys.description(artifact.id))}
              type="button"
              className={styles.small}
              onClick={() => setDescribing(!describing)}
              aria-expanded={describing}
              aria-label={`${artifact.name} description`}
            >
              {artifact.description ? 'Description ✓' : 'Description'}
            </button>
            <MoveButtons
              scope={`item:${artifact.id}`}
              name={artifact.name}
              busy={busy}
              control={control}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMove={onMove}
            />
            <button
              ref={control(keys.remove(artifact.id))}
              type="button"
              className={styles.small}
              onClick={remove}
              disabled={artifact.referenced}
              aria-disabled={busy}
              aria-label={`Delete ${artifact.name}`}
              title={artifact.referenced ? 'Has scores or notes. Mark it retired instead.' : undefined}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {describing && (
        <tr>
          <td colSpan={ITEM_COLUMNS}>
            <div className={styles.descriptionEditor}>
              <textarea
                ref={control(keys.descriptionText(artifact.id))}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                aria-label={`${artifact.name} description text`}
              />
              <div className={styles.descriptionActions}>
                <span className={styles.counter} data-over={descriptionLength > DESCRIPTION_MAX}>
                  {descriptionLength}/{DESCRIPTION_MAX}
                </span>
                <button
                  type="button"
                  className={styles.small}
                  onClick={saveDescription}
                  aria-disabled={busy || !descriptionChanged}
                  aria-label={`Save ${artifact.name} description`}
                >
                  Save
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface AddArtifactFormProps extends WriteProps {
  workload: AdminWorkload;
}

export function AddArtifactForm({ workload, busy, run, control }: AddArtifactFormProps) {
  const [name, setName] = useState('');
  const [id, setId] = useState<string>();
  const [status, setStatus] = useState<ReleaseStatus>('ga');
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const add = actions.addArtifact({ id: slug, name, workload: workload.id, status });
    if (await run(add, [keys.add(workload.id)])) {
      setName('');
      setId(undefined);
      setStatus('ga');
    }
  };

  return (
    <form className={styles.fields} onSubmit={submit}>
      <label className={styles.field}>
        <span>New item</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`New item in ${workload.name}`}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Id</span>
        <input
          value={slug}
          onChange={(event) => setId(event.target.value)}
          aria-label={`New item id in ${workload.name}`}
          spellCheck={false}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ReleaseStatus)}
          aria-label={`New item status in ${workload.name}`}
        >
          {STATUSES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        ref={control(keys.add(workload.id))}
        type="submit"
        className={styles.secondary}
        aria-disabled={busy}
        aria-label={`Add item to ${workload.name}`}
      >
        Add item
      </button>
    </form>
  );
}

function AddWorkloadForm({ busy, run, control }: WriteProps) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [id, setId] = useState<string>();
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(actions.addWorkload({ id: slug, name, shortName, blurb }), [keys.addWorkload])) {
      setName('');
      setShortName('');
      setBlurb('');
      setId(undefined);
    }
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <h2 className={styles.panelTitle}>Add a workload</h2>
      <div className={styles.workloadForm}>
        <label className={styles.field}>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className={styles.field}>
          <span>Short name</span>
          <input value={shortName} onChange={(event) => setShortName(event.target.value)} required />
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Description</span>
          <input value={blurb} onChange={(event) => setBlurb(event.target.value)} required />
        </label>
        <label className={styles.field}>
          <span>Id</span>
          <input value={slug} onChange={(event) => setId(event.target.value)} spellCheck={false} required />
        </label>
        <button ref={control(keys.addWorkload)} type="submit" className={styles.secondary} aria-disabled={busy}>
          Add workload
        </button>
      </div>
    </form>
  );
}
