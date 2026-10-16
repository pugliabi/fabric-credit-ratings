import type { CSSProperties } from 'react';
import { FACTORS } from '../data/factors';
import { BAND_META, MAX_SCORE, MIN_SCORE } from '../domain/grades';
import type { Band } from '../domain/types';
import { GradeBadge } from './GradeBadge';
import styles from './HowItWorks.module.css';

const BANDS = ['investment', 'lowInvestment', 'speculative', 'distressed'] as const satisfies readonly Band[];

const BAND_COPY: Readonly<Record<(typeof BANDS)[number], string>> = {
  investment: 'The item does its job well. You can build on it.',
  lowInvestment: 'Does the job today, with rough edges or costs to budget for.',
  speculative: 'Usable, with gaps you should plan around.',
  distressed: 'Falling behind, or the wrong tool for new work.',
};

export function HowItWorks() {
  return (
    <section id="how-it-works" className={styles.section} aria-labelledby="how-it-works-heading">
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Methodology</p>
        <h2 id="how-it-works-heading" className={styles.title}>
          How the ratings work
        </h2>
        <p className={styles.lede}>
          Every Fabric item is scored from {MIN_SCORE} to {MAX_SCORE} on four factors, where {MAX_SCORE} is best. Those
          scores, along with other factors such as release status and reliability, inform a rating from AAA down to C.
        </p>
      </header>

      <ol className={styles.factors}>
        {FACTORS.map((factor, i) => (
          <li key={factor.id} className={styles.factor}>
            <span className={styles.factorIndex}>{i + 1}</span>
            <h3 className={styles.factorName}>{factor.label}</h3>
            <p className={styles.factorQuestion}>{factor.question}</p>
            <dl className={styles.anchors}>
              <div>
                <dt>{MIN_SCORE}</dt>
                <dd>{factor.low}</dd>
              </div>
              <div>
                <dt>{MAX_SCORE}</dt>
                <dd>{factor.high}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Rating bands</h3>
        <p className={styles.blockText}>
          The scores and those other factors place an item in one of four bands. Deprecated items sit outside them.
        </p>
        <ul className={styles.bands}>
          {BANDS.map((band) => {
            const meta = BAND_META[band];
            return (
              <li
                key={band}
                style={{ '--cell-color': meta.color, '--cell-bg': meta.background } as CSSProperties}
              >
                <span className={styles.bandName}>{meta.label}</span>
                <span className={styles.bandRange}>{meta.range}</span>
                <span className={styles.blockText}>{BAND_COPY[band]}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.grid}>
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Deprecated</h3>
          <div className={styles.deprecated}>
            <GradeBadge grade="D" size="lg" />
            <p className={styles.blockText}>Retired items are rated D. Plan a migration.</p>
          </div>
        </div>

        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Reviews and history</h3>
          <p className={styles.blockText}>
            Ratings are reviewed in rounds, such as Q4 2026. When more than one rater scores an item in a round, their
            scores are averaged. Each published round adds an entry to the item's history, listed as an upgrade,
            downgrade, or affirmation. An item skipped in a round keeps its last rating.
          </p>
        </div>
      </div>
    </section>
  );
}
