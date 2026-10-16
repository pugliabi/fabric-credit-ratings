import type { CSSProperties } from 'react';
import { FACTORS } from '../data/factors';
import { MAX_SCORE } from '../domain/grades';
import type { FactorValues } from '../domain/types';
import { formatScore } from '../lib/format';
import styles from './FactorBars.module.css';

const SEGMENTS = Array.from({ length: MAX_SCORE }, (_, i) => i + 1);

export function scoreColor(score: number): string {
  if (score >= 6) return 'var(--band-investment)';
  if (score >= 4) return 'var(--fabric-green-soft)';
  if (score >= 3) return 'var(--band-speculative)';
  return 'var(--band-distressed)';
}

/** Share of segment n (1-based) covered by the score: 6.5 fills segment 7 halfway. */
function segmentFill(score: number, n: number): number {
  return Math.min(1, Math.max(0, score - (n - 1)));
}

export function FactorBars({ scores }: { scores: FactorValues }) {
  return (
    <ul className={styles.list}>
      {FACTORS.map((factor) => {
        const score = scores[factor.id];
        if (score === null) {
          return (
            <li key={factor.id} className={styles.factor} data-na>
              <div className={styles.header}>
                <span className={styles.label}>{factor.label}</span>
                <span className={styles.value}>Not applicable</span>
              </div>
            </li>
          );
        }
        return (
          <li key={factor.id} className={styles.factor}>
            <div className={styles.header}>
              <span className={styles.label}>{factor.label}</span>
              <span className={styles.value}>
                <strong>{formatScore(score)}</strong>/{MAX_SCORE}
              </span>
            </div>
            <span
              className={styles.track}
              role="meter"
              aria-label={factor.label}
              aria-valuemin={1}
              aria-valuemax={MAX_SCORE}
              aria-valuenow={score}
              style={{ '--fill': scoreColor(score) } as CSSProperties}
            >
              {SEGMENTS.map((n) => (
                <span
                  key={n}
                  className={styles.segment}
                  style={{ '--segment-fill': `${segmentFill(score, n) * 100}%` } as CSSProperties}
                />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
