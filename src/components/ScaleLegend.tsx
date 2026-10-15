import type { CSSProperties } from 'react';
import { BAND_META, BAND_ORDER, GRADES, bandOf } from '../domain/grades';
import styles from './ScaleLegend.module.css';

export function ScaleLegend() {
  return (
    <div className={styles.legend}>
      <p className={styles.caption}>Rating scale, best to worst</p>
      <ol className={styles.bands}>
        {BAND_ORDER.map((band) => {
          const meta = BAND_META[band];
          const grades = GRADES.filter((g) => bandOf(g) === band);
          return (
            <li
              key={band}
              className={styles.band}
              style={
                {
                  '--band-color': meta.color,
                  '--band-bg': meta.background,
                  flexGrow: grades.length,
                } as CSSProperties
              }
            >
              <span className={styles.bandLabel}>{meta.label}</span>
              <span className={styles.cells}>
                {grades.map((g) => (
                  <span key={g} className={styles.cell}>
                    {g}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
