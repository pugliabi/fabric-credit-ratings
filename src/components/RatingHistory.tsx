import { FACTORS } from '../data/factors';
import { notchDelta } from '../domain/grades';
import type { RatingPoint } from '../domain/types';
import { formatFullDate, formatScoreOrNa, pluralize } from '../lib/format';
import { GradeBadge } from './GradeBadge';
import styles from './RatingHistory.module.css';

type ActionKind = 'initiated' | 'upgrade' | 'downgrade' | 'affirmed' | 'deprecated';

function describe(point: RatingPoint, previous: RatingPoint | undefined): { kind: ActionKind; label: string } {
  if (point.grade === 'D' && previous?.grade !== 'D') return { kind: 'deprecated', label: 'Deprecated' };
  if (!previous) return { kind: 'initiated', label: 'Initiated' };
  const delta = notchDelta(previous.grade, point.grade);
  if (delta > 0) return { kind: 'upgrade', label: `Upgraded ${pluralize(delta, 'notch', 'notches')}` };
  if (delta < 0) return { kind: 'downgrade', label: `Downgraded ${pluralize(-delta, 'notch', 'notches')}` };
  return { kind: 'affirmed', label: 'Affirmed' };
}

export function RatingHistory({ history }: { history: RatingPoint[] }) {
  const entries = history.map((point, i) => ({ point, action: describe(point, history[i - 1]) })).reverse();

  return (
    <ol className={styles.list}>
      {entries.map(({ point, action }, i) => {
        const scoreText = FACTORS.map((factor) => formatScoreOrNa(point.scores[factor.id])).join(' · ');
        const scoreLabel = FACTORS.map((factor) => `${factor.label} ${formatScoreOrNa(point.scores[factor.id])}`).join(
          ', ',
        );
        return (
          <li key={point.round} className={styles.entry} data-current={i === 0}>
            <div className={styles.top}>
              <time className={styles.date} dateTime={point.date}>
                {formatFullDate(point.date)}
              </time>
              <span className={styles.action} data-kind={action.kind}>
                {action.label}
              </span>
              <span className={styles.scores} aria-label={scoreLabel}>
                <span aria-hidden="true">{scoreText}</span>
              </span>
              <GradeBadge grade={point.grade} size="sm" variant="pill" />
            </div>
            <p className={styles.note}>{i === 0 ? 'Current rating.' : point.note}</p>
          </li>
        );
      })}
    </ol>
  );
}
