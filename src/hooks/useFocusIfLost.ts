import { useEffect, useRef } from 'react';

/**
 * Focuses the returned element on mount if focus sits on <body>, as it does when the control that had it (Log in, Try
 * again, Open round) has just been removed.
 */
export function useFocusIfLost<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) ref.current?.focus();
  }, []);
  return ref;
}
