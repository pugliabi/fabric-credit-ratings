import styles from './Account.module.css';

interface UnavailableProps {
  message: string;
  onRetry: () => void;
}

export function Unavailable({ message, onRetry }: UnavailableProps) {
  return (
    <section className={styles.login} role="alert">
      <h2 className={styles.title}>The ratings server is not responding</h2>
      <p className={styles.muted}>{message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  );
}
