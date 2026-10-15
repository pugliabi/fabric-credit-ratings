import { useCallback, useEffect } from 'react';
import { HowItWorks } from './components/HowItWorks';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { SiteNav, type NavItem } from './components/SiteNav';
import { WorkloadSection } from './components/WorkloadSection';
import { asOfDate, getRatings, getUnrated, getWorkloads, groupByWorkload, openRound } from './data';
import { useAccordionState } from './hooks/useAccordionState';
import { useActiveSection } from './hooks/useActiveSection';
import styles from './App.module.css';

const RATINGS = getRatings();
const UNRATED = getUnrated(RATINGS);
const WORKLOADS = getWorkloads();
const GROUPS = groupByWorkload(RATINGS, (r) => r.artifact.workload);
const UNRATED_GROUPS = groupByWorkload(UNRATED, (a) => a.workload);
const AS_OF = asOfDate();
const OPEN_ROUND = openRound();
const WORKLOAD_IDS = WORKLOADS.map((w) => w.id);
const NAV_ITEMS: NavItem[] = [
  ...WORKLOADS.map((w) => ({ id: w.id, label: w.shortName })),
  { id: 'how-it-works', label: 'How It Works' },
];
const NAV_IDS = NAV_ITEMS.map((item) => item.id);
const NAV_OFFSET = 140;

function scrollToId(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', id === 'top' ? location.pathname : `#${id}`);
  });
}

export function App() {
  const accordion = useAccordionState();
  const active = useActiveSection(NAV_IDS, NAV_OFFSET);
  const { openSection, openRow } = accordion;

  const navigate = useCallback(
    (id: string) => {
      if (WORKLOAD_IDS.includes(id as (typeof WORKLOAD_IDS)[number])) openSection(id);
      scrollToId(id);
    },
    [openSection],
  );

  useEffect(() => {
    const applyHash = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!hash) return;
      const rating = RATINGS.find((r) => `item-${r.artifact.id}` === hash);
      const unrated = UNRATED.find((a) => `item-${a.id}` === hash);
      if (rating) {
        openRow(rating.artifact.workload, rating.artifact.id);
        scrollToId(hash);
      } else if (unrated) {
        openSection(unrated.workload);
        scrollToId(hash);
      } else if (NAV_IDS.includes(hash)) {
        navigate(hash);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [navigate, openRow, openSection]);

  return (
    <>
      <a className={styles.skipLink} href="#ratings">
        Skip to ratings
      </a>
      <SiteNav items={NAV_ITEMS} active={active} onNavigate={navigate} />
      <SiteHeader ratings={RATINGS} itemCount={RATINGS.length + UNRATED.length} asOf={AS_OF} />

      <main id="ratings" className={styles.main}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.toolbarTitle}>Ratings by workload</h2>
            <p className={styles.toolbarHint}>Open a workload, then an item, to see why it earned its rating.</p>
          </div>
          <div className={styles.controls}>
            <button type="button" className={styles.control} onClick={() => accordion.expandAll(WORKLOAD_IDS)}>
              Expand all
            </button>
            <button type="button" className={styles.control} onClick={accordion.collapseAll}>
              Collapse all
            </button>
          </div>
        </div>

        <div className={styles.sections}>
          {WORKLOADS.map((workload) => (
            <WorkloadSection
              key={workload.id}
              workload={workload}
              ratings={GROUPS.get(workload.id) ?? []}
              unrated={UNRATED_GROUPS.get(workload.id) ?? []}
              open={accordion.isSectionOpen(workload.id)}
              openRowId={accordion.openRowIn(workload.id)}
              asOf={AS_OF}
              onToggle={() => accordion.toggleSection(workload.id)}
              onToggleRow={(rowId) => accordion.toggleRow(workload.id, rowId)}
              onCloseRow={() => accordion.closeRow(workload.id)}
            />
          ))}
        </div>

        <HowItWorks />
      </main>

      <SiteFooter asOf={AS_OF} openRoundLabel={OPEN_ROUND?.label} />
    </>
  );
}
