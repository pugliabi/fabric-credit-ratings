import type { Rating } from '../domain/types';
import { formatFullDate } from '../lib/format';
import { DriverList } from './DriverList';
import { FactorBars } from './FactorBars';
import { HistorySparkline } from './HistorySparkline';
import { RatingHistory } from './RatingHistory';
import { ScoreSum } from './ScoreSum';
import styles from './ArtifactDetail.module.css';

interface ArtifactDetailProps {
  rating: Rating;
  asOf: string;
}

export function ArtifactDetail({ rating, asOf }: ArtifactDetailProps) {
  const { current, history, upside, downside } = rating;

  return (
    <div className={styles.detail}>
      <div className={styles.column}>
        <section>
          <h4 className={styles.title}>Why this rating</h4>
          <p className={styles.rationale}>{current.note}</p>
          <p className={styles.meta}>Rated {formatFullDate(current.date)}</p>
        </section>

        <section>
          <h4 className={styles.title}>Scores</h4>
          <FactorBars scores={current.scores} />
          <ScoreSum point={current} />
        </section>

        {(upside.length > 0 || downside.length > 0) && (
          <section>
            <h4 className={styles.title}>What would move it</h4>
            <DriverList upside={upside} downside={downside} />
          </section>
        )}
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
