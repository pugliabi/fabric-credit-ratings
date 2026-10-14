import { formatFullDate } from '../lib/format';
import styles from './SiteFooter.module.css';

export function SiteFooter({ asOf }: { asOf: string }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.brand}>Microsoft Fabric Credit Ratings</p>
        <p>
          Ratings as of {formatFullDate(asOf)}. Example ratings for design review, not real assessments.
        </p>
        <p className={styles.fine}>
          Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of
          Microsoft Corporation.
        </p>
      </div>
    </footer>
  );
}
