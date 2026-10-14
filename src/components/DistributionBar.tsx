import type { CSSProperties } from 'react';
import { BAND_META, BAND_ORDER, bandOf } from '../domain/scale';
import type { Grade } from '../domain/types';
import styles from './DistributionBar.module.css';

export function DistributionBar({ grades }: { grades: Grade[] }) {
  const counts = BAND_ORDER.map((band) => ({
    band,
    count: grades.filter((g) => bandOf(g) === band).length,
  })).filter((c) => c.count > 0);

  const label = counts.map((c) => `${c.count} ${BAND_META[c.band].label.toLowerCase()}`).join(', ');

  return (
    <span className={styles.bar} role="img" aria-label={label}>
      {counts.map((c) => (
        <span
          key={c.band}
          className={styles.segment}
          style={{ flexGrow: c.count, '--segment-color': BAND_META[c.band].color } as CSSProperties}
        />
      ))}
    </span>
  );
}
