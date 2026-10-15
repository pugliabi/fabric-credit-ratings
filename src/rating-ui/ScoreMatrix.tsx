import { memo, useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Chevron } from '../components/Chevron';
import { scoreColor } from '../components/FactorBars';
import { ARTIFACTS } from '../data/artifacts';
import { FACTORS } from '../data/factors';
import { WORKLOADS } from '../data/workloads';
import { MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { Artifact, FactorValues, Score, WorkloadId } from '../domain/types';
import { formatScore } from '../lib/format';
import { EMPTY_TRIPLE, isBlank, isComplete, toScore, type Draft, type DraftScore, type DraftTriple } from './draft';
import styles from './ScoreMatrix.module.css';

const STATUS_LABEL = { preview: 'Preview', retired: 'Retired' } as const;
const UNSET_POSITION = 4;

interface ScoreMatrixProps {
  draft: Draft;
  onChange: (artifactId: string, triple: DraftTriple) => void;
  /** Published values per artifact, shown under the name as a reminder. */
  reference?: Readonly<Record<string, FactorValues>>;
  referenceLabel?: string;
}

export function ScoreMatrix({ draft, onChange, reference, referenceLabel = 'Current' }: ScoreMatrixProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<WorkloadId>>(new Set());

  const toggle = (id: WorkloadId) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={styles.matrix}>
      {WORKLOADS.map((workload) => {
        const items = ARTIFACTS.filter((artifact) => artifact.workload === workload.id);
        const rated = items.filter((artifact) => {
          const triple = draft[artifact.id];
          return triple !== undefined && isComplete(triple);
        }).length;
        const open = !collapsed.has(workload.id);
        const panelId = `matrix-${workload.id}`;

        return (
          <section key={workload.id} className={styles.group}>
            <h2 className={styles.groupHeading}>
              <button
                type="button"
                className={styles.groupBar}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(workload.id)}
              >
                <span className={styles.groupName}>{workload.name}</span>
                <span className={styles.groupProgress} data-done={rated === items.length}>
                  {rated}/{items.length} rated
                </span>
                <Chevron open={open} />
              </button>
            </h2>

            {open && (
              <div id={panelId} className={styles.panel}>
                <div className={styles.columns} aria-hidden="true">
                  <span>Item</span>
                  {FACTORS.map((factor) => (
                    <span key={factor.id}>{factor.label}</span>
                  ))}
                  <span />
                </div>
                <ul className={styles.rows}>
                  {items.map((artifact) => (
                    <MatrixRow
                      key={artifact.id}
                      artifact={artifact}
                      triple={draft[artifact.id] ?? EMPTY_TRIPLE}
                      reference={reference?.[artifact.id]}
                      referenceLabel={referenceLabel}
                      onChange={onChange}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface MatrixRowProps {
  artifact: Artifact;
  triple: DraftTriple;
  reference: FactorValues | undefined;
  referenceLabel: string;
  onChange: (artifactId: string, triple: DraftTriple) => void;
}

const MatrixRow = memo(function MatrixRow({ artifact, triple, reference, referenceLabel, onChange }: MatrixRowProps) {
  const blank = isBlank(triple);
  const complete = isComplete(triple);

  const setAt = (index: number, score: Score) => {
    const next: [DraftScore, DraftScore, DraftScore] = [...triple];
    next[index] = score;
    onChange(artifact.id, next);
  };

  return (
    <li className={styles.row} data-state={complete ? 'complete' : blank ? 'blank' : 'partial'}>
      <div className={styles.item}>
        <span className={styles.itemName}>{artifact.name}</span>
        {artifact.status !== 'ga' && (
          <span className={styles.status} data-status={artifact.status}>
            {STATUS_LABEL[artifact.status]}
          </span>
        )}
        {reference && (
          <span className={styles.reference}>
            {referenceLabel}: {formatScore(reference.capability)} · {formatScore(reference.ux)} ·{' '}
            {formatScore(reference.cost)}
          </span>
        )}
        {!blank && !complete && <span className={styles.partialNote}>Set all three, or clear</span>}
      </div>

      {FACTORS.map((factor, index) => (
        <ScoreSlider
          key={factor.id}
          label={`${artifact.name}, ${factor.label}`}
          factorLabel={factor.label}
          value={triple[index] ?? null}
          onChange={(score) => setAt(index, score)}
        />
      ))}

      <button
        type="button"
        className={styles.clear}
        onClick={() => onChange(artifact.id, EMPTY_TRIPLE)}
        disabled={blank}
        aria-label={`Clear ${artifact.name}`}
      >
        Clear
      </button>
    </li>
  );
});

interface ScoreSliderProps {
  label: string;
  factorLabel: string;
  value: DraftScore;
  onChange: (score: Score) => void;
}

/** A 1-7 range that starts unset: the first click, drag, or Enter sets it. */
function ScoreSlider({ label, factorLabel, value, onChange }: ScoreSliderProps) {
  const unset = value === null;
  const commit = (event: SyntheticEvent<HTMLInputElement>) => onChange(toScore(event.currentTarget.valueAsNumber));
  const commitOnKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (unset && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      commit(event);
    }
  };

  const filled = unset ? 0 : ((value - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;

  return (
    <label
      className={styles.slider}
      data-unset={unset}
      style={{ '--fill': unset ? 'var(--ink-faint)' : scoreColor(value), '--filled': `${filled}%` } as CSSProperties}
    >
      <span className={styles.sliderLabel}>{factorLabel}</span>
      <input
        type="range"
        min={MIN_SCORE}
        max={MAX_SCORE}
        step={1}
        value={value ?? UNSET_POSITION}
        aria-label={label}
        aria-valuetext={unset ? 'Not set' : String(value)}
        onChange={commit}
        onPointerUp={unset ? commit : undefined}
        onKeyDown={commitOnKey}
      />
      <output className={styles.sliderValue}>{value ?? '–'}</output>
    </label>
  );
}
