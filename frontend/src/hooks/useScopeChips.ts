import { useMemo } from 'react'
import { DOC_KIND_LABEL } from '@/lib/labels'
import { useWS } from '@/store/workspace'
import type { Agent } from '@/types'

/** An agent's scope grouped by document kind ("Circulars 3"), for the "Reads:" chips. */
export function useScopeChips(agent: Agent) {
  const files = useWS((s) => s.files)
  return useMemo(() => {
    const groups = new Map<string, { label: string; docIds: string[] }>()
    for (const id of agent.scope) {
      const f = files.find((x) => x.id === id)
      const key = f?.kind === 'document' ? f.docKind : id
      const g = groups.get(key) ?? { label: f?.kind === 'document' ? DOC_KIND_LABEL[f.docKind] : (f?.title ?? id), docIds: [] }
      g.docIds.push(id)
      groups.set(key, g)
    }
    return [...groups.values()]
  }, [agent.scope, files])
}
