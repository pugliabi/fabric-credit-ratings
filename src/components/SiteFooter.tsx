import { formatFullDate } from '../lib/format';
import styles from './SiteFooter.module.css';

interface SiteFooterProps {
  asOf: string;
}

export function SiteFooter({ asOf }: SiteFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.brand}>Microsoft Fabric Credit Ratings</p>
        {asOf && <p>Ratings as of {formatFullDate(asOf)}.</p>}
        <p>
          Raters: <a href="/rate">log in</a> to score the open round.
        </p>
        <p className={styles.fine}>
          Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of
          Microsoft Corporation.
        </p>
      </div>
    </footer>
  );
}
