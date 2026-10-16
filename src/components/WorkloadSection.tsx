import { useRef, type KeyboardEvent } from 'react';
import { gradeIndex, isInvestmentGrade, medianGrade } from '../domain/grades';
import type { Rating, Workload } from '../domain/types';
import { pluralize } from '../lib/format';
import { ArtifactRow } from './ArtifactRow';
import { Chevron } from './Chevron';
import { Collapsible } from './Collapsible';
import { DistributionBar } from './DistributionBar';
import { GradeBadge } from './GradeBadge';
import styles from './WorkloadSection.module.css';

interface WorkloadSectionProps {
  workload: Workload;
  ratings: Rating[];
  open: boolean;
  openRowId: string | undefined;
  asOf: string;
  onToggle: () => void;
  onToggleRow: (rowId: string) => void;
  onCloseRow: () => void;
}

export function WorkloadSection({
  workload,
  ratings,
  open,
  openRowId,
  asOf,
  onToggle,
  onToggleRow,
  onCloseRow,
}: WorkloadSectionProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sorted = [...ratings].sort(
    (a, b) => gradeIndex(a.current.grade) - gradeIndex(b.current.grade) || a.artifact.name.localeCompare(b.artifact.name),
  );
  const grades = sorted.map((r) => r.current.grade);
  const median = medianGrade(grades);
  const investment = grades.filter(isInvestmentGrade).length;
  const headingId = `${workload.id}-heading`;
  const panelId = `${workload.id}-panel`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    if (openRowId) {
      event.stopPropagation();
      onCloseRow();
      document.getElementById(`row-${openRowId}`)?.focus();
    } else if (open) {
      event.stopPropagation();
      onToggle();
      buttonRef.current?.focus();
    }
  };

  return (
    <section id={workload.id} className={styles.section} data-open={open} onKeyDown={handleKeyDown}>
      <h2 className={styles.heading}>
        <button
          ref={buttonRef}
          id={headingId}
          type="button"
          className={styles.bar}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className={styles.titleBlock}>
            <span className={styles.name}>{workload.name}</span>
            <span className={styles.meta}>
              {pluralize(sorted.length, 'item')} · {workload.blurb}
            </span>
          </span>
          <span className={styles.summary}>
            {sorted.length > 0 ? (
              <>
                <span className={styles.summaryText}>
                  <span className={styles.summaryStrong}>{investment}</span> of {sorted.length} investment grade
                </span>
                <DistributionBar grades={grades} />
              </>
            ) : (
              <span className={styles.summaryText}>Not yet rated</span>
            )}
          </span>
          <span className={styles.median}>
            <span className={styles.medianLabel}>Median</span>
            {median ? <GradeBadge grade={median} size="md" /> : <span className={styles.medianNone}>NR</span>}
          </span>
          <Chevron open={open} />
        </button>
      </h2>

      <Collapsible id={panelId} open={open} labelledBy={headingId}>
        <ul className={styles.rows}>
          {sorted.map((rating) => (
            <li key={rating.artifact.id}>
              <ArtifactRow
                rating={rating}
                asOf={asOf}
                open={openRowId === rating.artifact.id}
                onToggle={() => onToggleRow(rating.artifact.id)}
              />
            </li>
          ))}
        </ul>
      </Collapsible>
    </section>
  );
}
