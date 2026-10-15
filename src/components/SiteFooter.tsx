import { formatFullDate } from '../lib/format';
import styles from './SiteFooter.module.css';

interface SiteFooterProps {
  asOf: string;
  /** Label of the round currently taking scores, if any. */
  openRoundLabel?: string;
}

export function SiteFooter({ asOf, openRoundLabel }: SiteFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.brand}>Microsoft Fabric Credit Ratings</p>
        {asOf && <p>Ratings as of {formatFullDate(asOf)}.</p>}
        {openRoundLabel && (
          <p>
            Raters: <a href="/rate">submit your {openRoundLabel} scores</a>.
          </p>
        )}
        <p className={styles.fine}>
          Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of
          Microsoft Corporation.
        </p>
      </div>
    </footer>
  );
}
