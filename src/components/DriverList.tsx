import styles from './DriverList.module.css';

interface DriverListProps {
  upside: string[];
  downside: string[];
}

export function DriverList({ upside, downside }: DriverListProps) {
  return (
    <div className={styles.drivers}>
      {upside.length > 0 && (
        <div>
          <p className={styles.heading} data-direction="up">
            <span aria-hidden="true">▲</span> Upgrade if
          </p>
          <ul className={styles.list}>
            {upside.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {downside.length > 0 && (
        <div>
          <p className={styles.heading} data-direction="down">
            <span aria-hidden="true">▼</span> Downgrade if
          </p>
          <ul className={styles.list}>
            {downside.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
