import type { MouseEvent } from 'react';
import styles from './SiteNav.module.css';

// The Threaded A logo in its small cut, drawn for 32 px and below (brand/svg/fcr-symbol-small.svg).
const MARK = [
  'M36 224 L88 224 L94.33 208 L42.33 208 Z',
  'M67.67 144 L112 32 L144 32 L220 224 L168 224 L128 122.95 L119.67 144 Z',
  'M12 160 L125.46 160 L138.13 192 L12 192 Z',
  'M211.87 160 L244 160 L244 192 L224.54 192 Z',
].join(' ');

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
        <a
          className={styles.brand}
          href="#top"
          aria-label="Fabric Credit Ratings"
          onClick={(e) => handleClick(e, 'top')}
        >
          <svg className={styles.mark} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            <path d={MARK} />
          </svg>
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
