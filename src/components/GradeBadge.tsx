import type { CSSProperties } from 'react';
import { BAND_META, bandOf, spokenGrade } from '../domain/grades';
import type { Grade } from '../domain/types';
import styles from './GradeBadge.module.css';

interface GradeBadgeProps {
  grade: Grade;
  size?: 'sm' | 'md' | 'lg';
  showBand?: boolean;
  variant?: 'text' | 'pill';
}

export function GradeBadge({ grade, size = 'md', showBand = false, variant = 'text' }: GradeBadgeProps) {
  const band = BAND_META[bandOf(grade)];
  const style = { '--grade-color': band.color, '--grade-bg': band.background } as CSSProperties;

  return (
    <span className={styles.badge} data-size={size} data-variant={variant} style={style}>
      <span className={styles.grade} aria-hidden="true">
        {grade}
      </span>
      <span className="visually-hidden">
        {spokenGrade(grade)}
        {showBand ? `, ${band.label}` : ''}
      </span>
      {showBand && (
        <span className={styles.band} aria-hidden="true">
          {band.shortLabel}
        </span>
      )}
    </span>
  );
}
