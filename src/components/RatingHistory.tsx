import { OUTLOOK_META, notchDelta } from '../domain/scale';
import type { RatingPoint } from '../domain/types';
import { formatFullDate, pluralize } from '../lib/format';
import { GradeBadge } from './GradeBadge';
import styles from './RatingHistory.module.css';

type ActionKind = 'initiated' | 'upgrade' | 'downgrade' | 'affirmed' | 'flag';

function describe(point: RatingPoint, previous: RatingPoint | undefined): { kind: ActionKind; label: string } {
  if (!previous) return { kind: 'initiated', label: 'Initiated' };
  if (point.flag && point.flag !== previous.flag) {
    return { kind: 'flag', label: point.flag === 'broken' ? 'Flagged broken' : 'Withdrawn' };
  }
  if (previous.flag && !point.flag) return { kind: 'upgrade', label: 'Restored' };
  const delta = notchDelta(previous.grade, point.grade);
  if (delta > 0) return { kind: 'upgrade', label: `Upgraded ${pluralize(delta, 'notch', 'notches')}` };
  if (delta < 0) return { kind: 'downgrade', label: `Downgraded ${pluralize(-delta, 'notch', 'notches')}` };
  if (point.outlook !== previous.outlook) {
    return { kind: 'affirmed', label: `Affirmed, outlook ${OUTLOOK_META[point.outlook].label.toLowerCase()}` };
  }
  return { kind: 'affirmed', label: 'Affirmed' };
}

export function RatingHistory({ history }: { history: RatingPoint[] }) {
  const entries = history.map((point, i) => ({ point, action: describe(point, history[i - 1]) })).reverse();

  return (
    <ol className={styles.list}>
      {entries.map(({ point, action }, i) => (
        <li key={point.date} className={styles.entry} data-current={i === 0}>
          <div className={styles.top}>
            <time className={styles.date} dateTime={point.date}>
              {formatFullDate(point.date)}
            </time>
            <span className={styles.action} data-kind={action.kind}>
              {action.label}
            </span>
            <span className={styles.scores}>
              {point.scores.capability} · {point.scores.ux} · {point.scores.cost} ={' '}
              <strong>{point.total}</strong>
            </span>
            <GradeBadge grade={point.grade} size="sm" variant="pill" />
          </div>
          <p className={styles.note}>{i === 0 ? 'Current rating.' : point.note}</p>
        </li>
      ))}
    </ol>
  );
}
