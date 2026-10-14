import type { CSSProperties } from 'react';
import { FACTORS } from '../data/factors';
import {
  BAND_META,
  INVESTMENT_GRADE_FLOOR,
  MAX_SCORE,
  MAX_TOTAL,
  MIN_SCORE,
  MIN_TOTAL,
  OUTLOOK_META,
  TOTAL_TO_GRADE,
  bandOf,
} from '../domain/scale';
import type { Grade, Outlook } from '../domain/types';
import { GradeBadge } from './GradeBadge';
import { OutlookChip } from './OutlookChip';
import styles from './HowItWorks.module.css';

const TOTALS = Array.from({ length: MAX_TOTAL - MIN_TOTAL + 1 }, (_, i) => MAX_TOTAL - i);
const OUTLOOKS = Object.keys(OUTLOOK_META) as Outlook[];
const EXAMPLE_SCORES = [6, 7, 6] as const;
const EXAMPLE_TOTAL = EXAMPLE_SCORES.reduce((sum, n) => sum + n, 0);

export function HowItWorks() {
  return (
    <section id="how-it-works" className={styles.section} aria-labelledby="how-it-works-heading">
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Methodology</p>
        <h2 id="how-it-works-heading" className={styles.title}>
          How the ratings work
        </h2>
        <p className={styles.lede}>
          Every Fabric item is scored from {MIN_SCORE} to {MAX_SCORE} on three factors, where {MAX_SCORE} is best. The
          three scores add up to a total between {MIN_TOTAL} and {MAX_TOTAL}, and each point of the total is one notch
          on the rating scale.
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

      <div className={styles.formula}>
        {FACTORS.map((factor, i) => (
          <span key={factor.id} className={styles.formulaPart}>
            {i > 0 && (
              <span className={styles.formulaOp} aria-hidden="true">
                +
              </span>
            )}
            <span className={styles.formulaTerm}>
              <span className={styles.formulaLabel}>{factor.label}</span>
              <span className={styles.formulaValue}>{EXAMPLE_SCORES[i]}</span>
            </span>
          </span>
        ))}
        <span className={styles.formulaOp} aria-hidden="true">
          =
        </span>
        <span className={styles.formulaTerm}>
          <span className={styles.formulaLabel}>Total</span>
          <span className={styles.formulaValue}>
            {EXAMPLE_TOTAL}
            <span className={styles.formulaMax}>/{MAX_TOTAL}</span>
          </span>
        </span>
        <span className={styles.formulaOp} aria-hidden="true">
          →
        </span>
        <span className={styles.formulaTerm}>
          <span className={styles.formulaLabel}>Rating</span>
          <GradeBadge grade={TOTAL_TO_GRADE[EXAMPLE_TOTAL] as Grade} size="lg" />
        </span>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Total to rating</h3>
        <p className={styles.blockText}>
          A total of {INVESTMENT_GRADE_FLOOR} (an average score of 4, the middle of the scale) is the lowest investment
          grade.
        </p>
        <ol className={styles.table}>
          {TOTALS.map((total) => {
            const grade = TOTAL_TO_GRADE[total] as Grade;
            const meta = BAND_META[bandOf(grade)];
            return (
              <li
                key={total}
                className={styles.cell}
                data-floor={total === INVESTMENT_GRADE_FLOOR}
                style={{ '--cell-color': meta.color, '--cell-bg': meta.background } as CSSProperties}
              >
                <span className={styles.cellTotal}>{total}</span>
                <span className={styles.cellGrade}>{grade}</span>
              </li>
            );
          })}
        </ol>
        <ul className={styles.tableLegend}>
          {(['investment', 'speculative', 'distressed'] as const).map((band) => (
            <li key={band} style={{ '--cell-color': BAND_META[band].color } as CSSProperties}>
              {BAND_META[band].label} <span>{BAND_META[band].range}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.grid}>
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Flags override the total</h3>
          <ul className={styles.flags}>
            <li>
              <GradeBadge grade="D" size="lg" />
              <div>
                <p className={styles.flagName}>Broken</p>
                <p className={styles.blockText}>An outage or a blocking defect. Restored on the next good review.</p>
              </div>
            </li>
            <li>
              <GradeBadge grade="E" size="lg" />
              <div>
                <p className={styles.flagName}>Withdrawn</p>
                <p className={styles.blockText}>Retired or deprecated. Plan a migration.</p>
              </div>
            </li>
          </ul>
        </div>

        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Outlook</h3>
          <ul className={styles.outlooks}>
            {OUTLOOKS.map((outlook) => (
              <li key={outlook}>
                <OutlookChip outlook={outlook} />
                <span className={styles.blockText}>{OUTLOOK_META[outlook].description}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.block}>
          <h3 className={styles.blockTitle}>History</h3>
          <p className={styles.blockText}>
            Each rating is a dated scoring entry. The newest entry for an item is its current rating, and earlier
            entries make up its history. A rating only changes when a new entry is scored, and every change is listed
            as an upgrade, downgrade, or affirmation.
          </p>
        </div>
      </div>
    </section>
  );
}
