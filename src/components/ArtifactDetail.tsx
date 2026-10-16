import type { Rating } from '../domain/types';
import { formatFullDate } from '../lib/format';
import { FactorBars } from './FactorBars';
import { HistorySparkline } from './HistorySparkline';
import { RatingHistory } from './RatingHistory';
import styles from './ArtifactDetail.module.css';

interface ArtifactDetailProps {
  rating: Rating;
  asOf: string;
}

export function ArtifactDetail({ rating, asOf }: ArtifactDetailProps) {
  const { artifact, current, history } = rating;

  return (
    <div className={styles.detail}>
      <div className={styles.column}>
        <section>
          <h4 className={styles.title}>Why this rating</h4>
          {current.note && <p className={styles.rationale}>{current.note}</p>}
          <p className={styles.meta}>
            Rated {formatFullDate(current.date)} in the {current.roundLabel} review
            {current.raters > 1 && ` · average of ${current.raters} raters`}
          </p>
        </section>

        <section>
          <h4 className={styles.title}>Scores</h4>
          <FactorBars scores={current.scores} />
          {artifact.status === 'retired' && (
            <p className={styles.retiredNote}>Retired, so it's rated D regardless of scores.</p>
          )}
        </section>
      </div>

      <div className={styles.column}>
        <section>
          <h4 className={styles.title}>Rating history</h4>
          <HistorySparkline history={history} asOf={asOf} />
        </section>
        <RatingHistory history={history} />
      </div>
    </div>
  );
}
