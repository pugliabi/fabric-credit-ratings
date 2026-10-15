import type { Artifact, Rating } from '../domain/types';
import { ArtifactDetail } from './ArtifactDetail';
import { Chevron } from './Chevron';
import { Collapsible } from './Collapsible';
import { GradeBadge } from './GradeBadge';
import styles from './ArtifactRow.module.css';

const STATUS_LABEL = { preview: 'Preview', retired: 'Retired' } as const;

interface ArtifactRowProps {
  rating: Rating;
  asOf: string;
  open: boolean;
  onToggle: () => void;
}

export function ArtifactRow({ rating, asOf, open, onToggle }: ArtifactRowProps) {
  const { artifact, current } = rating;
  const buttonId = `row-${artifact.id}`;
  const panelId = `detail-${artifact.id}`;

  return (
    <div id={`item-${artifact.id}`} className={styles.row} data-open={open}>
      <h3 className={styles.heading}>
        <button
          id={buttonId}
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <NameBlock artifact={artifact} />
          <span className={styles.gradeCell}>
            <GradeBadge grade={current.grade} size="lg" showBand />
          </span>
          <Chevron open={open} />
        </button>
      </h3>

      <Collapsible id={panelId} open={open} labelledBy={buttonId}>
        <ArtifactDetail rating={rating} asOf={asOf} />
      </Collapsible>
    </div>
  );
}

export function UnratedRow({ artifact }: { artifact: Artifact }) {
  return (
    <div id={`item-${artifact.id}`} className={styles.row} data-unrated="true">
      <h3 className={styles.heading}>
        <span className={styles.trigger} data-static="true">
          <NameBlock artifact={artifact} />
          <span className={styles.gradeCell}>
            <span className={styles.notRated}>
              <span className={styles.notRatedGrade} aria-hidden="true">
                NR
              </span>
              <span className={styles.notRatedLabel}>Not rated</span>
            </span>
          </span>
          <span className={styles.chevronSpacer} aria-hidden="true" />
        </span>
      </h3>
    </div>
  );
}

function NameBlock({ artifact }: { artifact: Artifact }) {
  return (
    <span className={styles.nameBlock}>
      <span className={styles.name}>{artifact.name}</span>
      {artifact.status !== 'ga' && (
        <span className={styles.status} data-status={artifact.status}>
          {STATUS_LABEL[artifact.status]}
        </span>
      )}
    </span>
  );
}
