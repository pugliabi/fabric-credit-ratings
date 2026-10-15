import { useEffect, useState } from 'react';
import { onSlow } from '../lib/api';
import styles from './Account.module.css';

/** Fabric SQL pauses when idle; the first request afterwards can take a while. */
export function WakeNotice() {
  const [slow, setSlow] = useState(false);

  useEffect(() => onSlow(setSlow), []);

  if (!slow) return null;
  return (
    <p className={styles.wake} role="status">
      Waking the ratings database. The first request after a quiet spell can take up to a minute.
    </p>
  );
}
