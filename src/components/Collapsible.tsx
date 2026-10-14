import type { ReactNode } from 'react';
import styles from './Collapsible.module.css';

interface CollapsibleProps {
  id: string;
  open: boolean;
  labelledBy?: string;
  children: ReactNode;
}

export function Collapsible({ id, open, labelledBy, children }: CollapsibleProps) {
  return (
    <div id={id} className={styles.root} data-open={open} role="region" aria-labelledby={labelledBy}>
      <div className={styles.inner} inert={!open}>
        {children}
      </div>
    </div>
  );
}
