import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminArtifact, AdminCatalog, AdminWorkload } from '../domain/api-types';
import type { ReleaseStatus } from '../domain/types';
import { api } from '../lib/api';
import { endOfWorkload, reorder, reservedIdProblem, slugify } from './catalog-order';
import { saveOrders, writeCatalog } from './catalog-write';
import styles from './Admin.module.css';

const STATUSES: { id: ReleaseStatus; label: string }[] = [
  { id: 'ga', label: 'GA' },
  { id: 'preview', label: 'Preview' },
  { id: 'retired', label: 'Retired' },
];

/** Runs one or more catalog writes; the last response is the new catalog. Resolves false on failure. */
type Run = (action: () => Promise<AdminCatalog>) => Promise<boolean>;

function workloadBody(workload: AdminWorkload) {
  return { name: workload.name, shortName: workload.shortName, blurb: workload.blurb };
}

function artifactBody(artifact: AdminArtifact) {
  return { name: artifact.name, workload: artifact.workload, status: artifact.status };
}

interface CatalogTabProps {
  catalog: AdminCatalog;
  onCatalog: (catalog: AdminCatalog) => void;
}

// Ids, names, and lengths are checked by the server, whose 400s are shown as is (no pattern or maxLength here).
export function CatalogTab({ catalog, onCatalog }: CatalogTabProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // The Add and Save buttons stay focusable while busy (aria-disabled), so a second press must be refused here.
  const running = useRef(false);
  const writes = useRef(0);

  // Scores saved since the page loaded (on the Score tab, or by raters) change which items can be deleted. A write
  // started meanwhile answers with a newer catalog, so this read is dropped then.
  useEffect(() => {
    const at = writes.current;
    void api<AdminCatalog>('GET', '/admin/catalog').then(
      (fresh) => {
        if (writes.current === at) onCatalog(fresh);
      },
      () => undefined,
    );
  }, [onCatalog]);

  const run: Run = async (action) => {
    if (running.current) return false;
    running.current = true;
    writes.current += 1;
    setBusy(true);
    setError('');
    setAttempt((count) => count + 1);
    try {
      return await writeCatalog(action, { onCatalog, onError: setError });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const moveWorkload = (from: number, to: number) =>
    run(() => saveOrders('/admin/workloads', reorder(catalog.workloads, from, to), workloadBody, catalog));

  return (
    <div className={styles.stack}>
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
          <button type="button" className={styles.small} onClick={() => setError('')}>
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
          canMoveUp={index > 0}
          canMoveDown={index < catalog.workloads.length - 1}
          onMove={(step) => void moveWorkload(index, index + step)}
        />
      ))}
      <AddWorkloadForm busy={busy} run={run} />
    </div>
  );
}

interface MoveProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (step: number) => void;
}

interface WorkloadBlockProps extends MoveProps {
  workload: AdminWorkload;
  catalog: AdminCatalog;
  busy: boolean;
  run: Run;
}

function WorkloadBlock({ workload, catalog, busy, run, canMoveUp, canMoveDown, onMove }: WorkloadBlockProps) {
  const [fields, setFields] = useState(() => workloadBody(workload));
  const items = catalog.artifacts.filter((artifact) => artifact.workload === workload.id);
  // The server trims, so compare and send trimmed values: Save would otherwise stay after saving "Name ".
  const trimmed = { name: fields.name.trim(), shortName: fields.shortName.trim(), blurb: fields.blurb.trim() };
  const changed =
    trimmed.name !== workload.name || trimmed.shortName !== workload.shortName || trimmed.blurb !== workload.blurb;

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      api<AdminCatalog>('PUT', `/admin/workloads/${workload.id}`, { ...trimmed, sortOrder: workload.sortOrder }),
    );
  };

  const moveItem = (from: number, to: number) =>
    run(() => saveOrders('/admin/artifacts', reorder(items, from, to), artifactBody, catalog));

  return (
    <section className={styles.panel}>
      <form className={styles.workloadForm} onSubmit={save}>
        <label className={styles.field}>
          <span>Workload</span>
          <input value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} required />
        </label>
        <label className={styles.field}>
          <span>Short name</span>
          <input
            value={fields.shortName}
            onChange={(event) => setFields({ ...fields, shortName: event.target.value })}
            required
          />
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span>Description</span>
          <input
            value={fields.blurb}
            onChange={(event) => setFields({ ...fields, blurb: event.target.value })}
            required
          />
        </label>
        <div className={styles.rowActions}>
          {changed && (
            <button type="submit" className={styles.primary} aria-disabled={busy}>
              Save
            </button>
          )}
          <MoveButtons
            name={workload.name}
            busy={busy}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
        </div>
      </form>
      {items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Id</th>
              <th>Status</th>
              <th>Workload</th>
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
                artifacts={catalog.artifacts}
                workloads={catalog.workloads}
                busy={busy}
                run={run}
                canMoveUp={index > 0}
                canMoveDown={index < items.length - 1}
                onMove={(step) => void moveItem(index, index + step)}
              />
            ))}
          </tbody>
        </table>
      )}
      <AddArtifactForm workloadId={workload.id} busy={busy} run={run} />
    </section>
  );
}

function MoveButtons({ name, busy, canMoveUp, canMoveDown, onMove }: MoveProps & { name: string; busy: boolean }) {
  return (
    <>
      <button
        type="button"
        className={styles.small}
        onClick={() => onMove(-1)}
        disabled={busy || !canMoveUp}
        aria-label={`Move ${name} up`}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.small}
        onClick={() => onMove(1)}
        disabled={busy || !canMoveDown}
        aria-label={`Move ${name} down`}
      >
        ↓
      </button>
    </>
  );
}

interface ArtifactRowEditorProps extends MoveProps {
  artifact: AdminArtifact;
  artifacts: readonly AdminArtifact[];
  workloads: readonly AdminWorkload[];
  busy: boolean;
  run: Run;
}

function ArtifactRowEditor({
  artifact,
  artifacts,
  workloads,
  busy,
  run,
  canMoveUp,
  canMoveDown,
  onMove,
}: ArtifactRowEditorProps) {
  const [name, setName] = useState(artifact.name);

  const update = (changes: Partial<ReturnType<typeof artifactBody>>) => {
    // An item moved to another workload goes to its end; its old sortOrder could tie with items there.
    const target = changes.workload ?? artifact.workload;
    const sortOrder = target === artifact.workload ? artifact.sortOrder : endOfWorkload(artifacts, target);
    void run(() =>
      api<AdminCatalog>('PUT', `/admin/artifacts/${artifact.id}`, { ...artifactBody(artifact), ...changes, sortOrder }),
    );
  };

  const remove = () => {
    if (confirm(`Delete ${artifact.name}? This cannot be undone.`)) {
      void run(() => api<AdminCatalog>('DELETE', `/admin/artifacts/${artifact.id}`));
    }
  };

  return (
    <tr>
      <td>
        <form
          className={styles.inline}
          onSubmit={(event) => {
            event.preventDefault();
            update({ name: name.trim() });
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={`Name of ${artifact.name}`}
            required
          />
          {name.trim() !== artifact.name && (
            <button type="submit" className={styles.small} disabled={busy}>
              Save
            </button>
          )}
        </form>
      </td>
      <td className={styles.code}>{artifact.id}</td>
      <td>
        <select
          value={artifact.status}
          onChange={(event) => update({ status: event.target.value as ReleaseStatus })}
          disabled={busy}
          aria-label={`Status of ${artifact.name}`}
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
          value={artifact.workload}
          onChange={(event) => update({ workload: event.target.value })}
          disabled={busy}
          aria-label={`Workload of ${artifact.name}`}
        >
          {workloads.map((workload) => (
            <option key={workload.id} value={workload.id}>
              {workload.shortName}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className={styles.rowActions}>
          <MoveButtons
            name={artifact.name}
            busy={busy}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
          <button
            type="button"
            className={styles.small}
            onClick={remove}
            disabled={busy || artifact.referenced}
            title={artifact.referenced ? 'Has scores or notes. Mark it retired instead.' : undefined}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddArtifactForm({ workloadId, busy, run }: { workloadId: string; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [id, setId] = useState<string>();
  const [status, setStatus] = useState<ReleaseStatus>('ga');
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => {
      const problem = reservedIdProblem('Item id', slug);
      if (problem) throw new Error(problem);
      return api<AdminCatalog>('POST', '/admin/artifacts', { id: slug, name: name.trim(), workload: workloadId, status });
    });
    if (ok) {
      setName('');
      setId(undefined);
      setStatus('ga');
    }
  };

  return (
    <form className={styles.fields} onSubmit={submit}>
      <label className={styles.field}>
        <span>New item</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className={styles.field}>
        <span>Id</span>
        <input value={slug} onChange={(event) => setId(event.target.value)} spellCheck={false} required />
      </label>
      <label className={styles.field}>
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as ReleaseStatus)}>
          {STATUSES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={styles.secondary} aria-disabled={busy}>
        Add item
      </button>
    </form>
  );
}

function AddWorkloadForm({ busy, run }: { busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [id, setId] = useState<string>();
  const slug = id ?? slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => {
      const problem = reservedIdProblem('Workload id', slug);
      if (problem) throw new Error(problem);
      return api<AdminCatalog>('POST', '/admin/workloads', {
        id: slug,
        name: name.trim(),
        shortName: shortName.trim(),
        blurb: blurb.trim(),
      });
    });
    if (ok) {
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
        <button type="submit" className={styles.secondary} aria-disabled={busy}>
          Add workload
        </button>
      </div>
    </form>
  );
}
