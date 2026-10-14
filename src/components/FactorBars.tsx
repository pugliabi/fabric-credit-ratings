import type { CSSProperties } from 'react';
import { FACTORS } from '../data/factors';
import { MAX_SCORE } from '../domain/scale';
import type { Score, Scores } from '../domain/types';
import styles from './FactorBars.module.css';

const SEGMENTS = Array.from({ length: MAX_SCORE }, (_, i) => i + 1);

export function scoreColor(score: Score): string {
  if (score >= 6) return 'var(--band-investment)';
  if (score >= 4) return 'var(--fabric-green-soft)';
  if (score === 3) return 'var(--band-speculative)';
  return 'var(--band-distressed)';
}

export function FactorBars({ scores }: { scores: Scores }) {
  return (
    <ul className={styles.list}>
      {FACTORS.map((factor) => {
        const score = scores[factor.id];
        return (
          <li key={factor.id} className={styles.factor}>
            <div className={styles.header}>
              <span className={styles.label}>{factor.label}</span>
              <span className={styles.value}>
                <strong>{score}</strong>/{MAX_SCORE}
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
                <span key={n} className={styles.segment} data-filled={n <= score} />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
