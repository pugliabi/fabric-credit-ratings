import { isInvestmentGrade, medianGrade } from '../domain/scale';
import type { Rating } from '../domain/types';
import { formatFullDate } from '../lib/format';
import { GradeBadge } from './GradeBadge';
import { ScaleLegend } from './ScaleLegend';
import styles from './SiteHeader.module.css';

interface SiteHeaderProps {
  ratings: Rating[];
  itemCount: number;
  asOf: string;
}

export function SiteHeader({ ratings, itemCount, asOf }: SiteHeaderProps) {
  const grades = ratings.map((r) => r.current.grade);
  const investment = grades.filter(isInvestmentGrade).length;
  const median = medianGrade(grades);

  return (
    <div id="top" className={styles.header}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Microsoft Fabric Credit Ratings</h1>
        <p className={styles.lede}>
          A bond-style rating for every Fabric item, from <strong>AAA</strong> down to <strong>E</strong>. Each item is
          scored 1 to 7 on feature capability, user experience, and CU / token cost.
        </p>

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Items rated</dt>
            <dd>
              {ratings.length}
              <span className={styles.statSub}> of {itemCount}</span>
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>Investment grade</dt>
            <dd>
              {investment}
              <span className={styles.statSub}> of {ratings.length}</span>
            </dd>
          </div>
          {median && (
            <div className={styles.stat}>
              <dt>Median rating</dt>
              <dd>
                <GradeBadge grade={median} size="md" variant="pill" />
              </dd>
            </div>
          )}
          {asOf && (
            <div className={styles.stat}>
              <dt>Ratings as of</dt>
              <dd className={styles.statDate}>{formatFullDate(asOf)}</dd>
            </div>
          )}
        </dl>

        <ScaleLegend />
      </div>
    </div>
  );
}
