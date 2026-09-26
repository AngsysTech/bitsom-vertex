import { useMemo } from 'react'
import { circularsAffecting, latestCards } from '@/lib/cards'
import { CARD_AGENT } from '@/lib/labels'
import { useWS } from '@/store/workspace'

/** Circular doc ids that change the current student's audit (drives "Affects your audit" + the unread dot). */
export function useAffectedCirculars() {
  const msgs = useWS((s) => s.threads[CARD_AGENT.audit]?.messages)
  return useMemo(() => circularsAffecting(latestCards(msgs).audit), [msgs])
}
