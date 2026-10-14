import type { CSSProperties } from 'react';
import { OUTLOOK_META } from '../domain/scale';
import type { Outlook } from '../domain/types';
import styles from './OutlookChip.module.css';

interface OutlookChipProps {
  outlook: Outlook;
  compact?: boolean;
}

export function OutlookChip({ outlook, compact = false }: OutlookChipProps) {
  const meta = OUTLOOK_META[outlook];
  return (
    <span
      className={styles.chip}
      data-compact={compact}
      style={{ '--outlook-color': meta.color } as CSSProperties}
      title={`Outlook ${meta.label}: ${meta.description}`}
    >
      <span className={styles.symbol} aria-hidden="true">
        {meta.symbol}
      </span>
      <span className={styles.label}>
        <span className="visually-hidden">Outlook </span>
        {meta.label}
      </span>
    </span>
  );
}
