import { CARD_AGENT } from '@/lib/labels'
import { useWS } from '@/store/workspace'
import type { WorkspaceFile } from '@/types'

/** Where a file came from: connector name for documents, producing agent for canvases. */
export function useFileSource(f: WorkspaceFile | undefined) {
  const connectors = useWS((s) => s.connectors)
  const agents = useWS((s) => s.agents)
  if (!f) return { label: '', synthetic: false }
  if (f.kind === 'canvas') return { label: `Canvas · ${agents.find((a) => a.id === CARD_AGENT[f.cardType])?.name ?? 'Agent'}`, synthetic: false }
  const c = connectors.find((x) => x.id === f.connectorId)
  return { label: c?.name ?? f.connectorId, synthetic: c?.status === 'synthetic' }
}
