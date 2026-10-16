import type { MouseEvent } from 'react';
import styles from './SiteNav.module.css';

export interface NavItem {
  id: string;
  label: string;
}

interface SiteNavProps {
  items: readonly NavItem[];
  active: string | undefined;
  onNavigate: (id: string) => void;
}

export function SiteNav({ items, active, onNavigate }: SiteNavProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    onNavigate(id);
  };

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#top" onClick={(e) => handleClick(e, 'top')}>
          <span className={styles.mark} aria-hidden="true">
            AAA
          </span>
          <span className={styles.brandText}>
            Fabric <span className={styles.brandAccent}>Credit Ratings</span>
          </span>
        </a>
        <nav aria-label="Sections" className={styles.scroller}>
          <ul className={styles.links}>
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={styles.link}
                  aria-current={active === item.id ? 'location' : undefined}
                  onClick={(e) => handleClick(e, item.id)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a className={`${styles.link} ${styles.about}`} href="/about.html">
          About
        </a>
      </div>
    </header>
  );
}
