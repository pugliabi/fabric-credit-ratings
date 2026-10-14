import { MAX_TOTAL, TOTAL_TO_GRADE } from '../domain/scale';
import type { RatingPoint } from '../domain/types';
import { GradeBadge } from './GradeBadge';
import styles from './ScoreSum.module.css';

export function ScoreSum({ point }: { point: RatingPoint }) {
  const { scores, total, grade, flag } = point;

  return (
    <div className={styles.sum}>
      <p className={styles.equation}>
        <span className={styles.term}>{scores.capability}</span>
        <span className={styles.op}>+</span>
        <span className={styles.term}>{scores.ux}</span>
        <span className={styles.op}>+</span>
        <span className={styles.term}>{scores.cost}</span>
        <span className={styles.op}>=</span>
        <span className={styles.total}>
          {total}
          <span className={styles.max}>/{MAX_TOTAL}</span>
        </span>
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <span className="visually-hidden">rated</span>
        <GradeBadge grade={grade} size="md" variant="pill" />
      </p>
      {flag && (
        <p className={styles.flagNote}>
          The {flag === 'broken' ? 'broken' : 'withdrawn'} flag overrides the total, which on its own would be{' '}
          {TOTAL_TO_GRADE[total]}.
        </p>
      )}
    </div>
  );
}
