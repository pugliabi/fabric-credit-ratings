import { MAX_TOTAL } from '../domain/scale';
import type { Rating } from '../domain/types';
import { ArtifactDetail } from './ArtifactDetail';
import { Chevron } from './Chevron';
import { Collapsible } from './Collapsible';
import { GradeBadge } from './GradeBadge';
import { OutlookChip } from './OutlookChip';
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
          <span className={styles.nameBlock}>
            <span className={styles.name}>{artifact.name}</span>
            {artifact.status !== 'ga' && (
              <span className={styles.status} data-status={artifact.status}>
                {STATUS_LABEL[artifact.status]}
              </span>
            )}
          </span>
          <OutlookChip outlook={current.outlook} compact />
          <span
            className={styles.total}
            data-overridden={Boolean(current.flag)}
            title={current.flag ? 'Total score, overridden by flag' : 'Total score'}
          >
            <span className={styles.totalValue}>{current.total}</span>
            <span className={styles.totalMax}>/{MAX_TOTAL}</span>
          </span>
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
