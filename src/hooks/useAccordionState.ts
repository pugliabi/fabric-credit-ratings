import { useCallback, useState } from 'react';

export interface AccordionState {
  isSectionOpen: (sectionId: string) => boolean;
  openRowIn: (sectionId: string) => string | undefined;
  toggleSection: (sectionId: string) => void;
  openSection: (sectionId: string) => void;
  closeSection: (sectionId: string) => void;
  toggleRow: (sectionId: string, rowId: string) => void;
  openRow: (sectionId: string, rowId: string) => void;
  closeRow: (sectionId: string) => void;
  expandAll: (sectionIds: readonly string[]) => void;
  collapseAll: () => void;
}

/** Several sections can be open; within a section only one row is open at a time. */
export function useAccordionState(): AccordionState {
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
  const [openRows, setOpenRows] = useState<Readonly<Record<string, string | undefined>>>({});

  const setSection = useCallback((sectionId: string, open: boolean) => {
    setOpenSections((prev) => {
      if (prev.has(sectionId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const toggleRow = useCallback((sectionId: string, rowId: string) => {
    setOpenRows((prev) => ({ ...prev, [sectionId]: prev[sectionId] === rowId ? undefined : rowId }));
  }, []);

  const openRow = useCallback(
    (sectionId: string, rowId: string) => {
      setSection(sectionId, true);
      setOpenRows((prev) => ({ ...prev, [sectionId]: rowId }));
    },
    [setSection],
  );

  const closeRow = useCallback((sectionId: string) => {
    setOpenRows((prev) => ({ ...prev, [sectionId]: undefined }));
  }, []);

  return {
    isSectionOpen: (sectionId) => openSections.has(sectionId),
    openRowIn: (sectionId) => openRows[sectionId],
    toggleSection,
    openSection: useCallback((sectionId: string) => setSection(sectionId, true), [setSection]),
    closeSection: useCallback((sectionId: string) => setSection(sectionId, false), [setSection]),
    toggleRow,
    openRow,
    closeRow,
    expandAll: useCallback((sectionIds: readonly string[]) => setOpenSections(new Set(sectionIds)), []),
    collapseAll: useCallback(() => {
      setOpenSections(new Set());
      setOpenRows({});
    }, []),
  };
}
