import { useCallback } from 'react';

/**
 * No-op order alert hook. Audio alarms were removed at the user's request.
 * Visual alerts (modal, badges, animations) are unaffected.
 */
export function useOrderAlert() {
  const noop = useCallback(() => {}, []);
  return { playAlert: noop, startAlert: noop, stopAlert: noop };
}
