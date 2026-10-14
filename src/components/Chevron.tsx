import styles from './Chevron.module.css';

export function Chevron({ open }: { open: boolean }) {
  return (
    <span className={styles.chevron} data-open={open} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="20" height="20">
        <path
          d="M5 7.5 10 12.5 15 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
