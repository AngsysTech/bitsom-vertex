// Hash routes (static-host friendly):
//   #/dm/:agentId  #/channel/:id  #/files  #/files/:docId[/:sectionId]  #/agents  #/advisor
import type { AgentId } from '@/types'
import { DEFAULT_AGENT } from './config'

export type Route =
  | { view: 'dm'; id: AgentId }
  | { view: 'channel'; id: string }
  | { view: 'files' }
  | { view: 'doc'; id: string; sec: string | null }
  | { view: 'agents' }
  | { view: 'advisor' }

const dec = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseHash(hash: string): Route {
  const [v, a, b] = hash.replace(/^#\/?/, '').split('/').map(dec)
  if (v === 'dm' && a) return { view: 'dm', id: a as AgentId }
  if (v === 'channel') return { view: 'channel', id: a || 'announcements' }
  if (v === 'files' && a) return { view: 'doc', id: a, sec: b || null }
  if (v === 'files') return { view: 'files' }
  if (v === 'agents') return { view: 'agents' }
  if (v === 'advisor') return { view: 'advisor' }
  return { view: 'dm', id: DEFAULT_AGENT }
}

export const routeKey = (r: Route) => ('id' in r ? `${r.view}:${r.id}` : r.view)

/** Navigate by path ("/dm/academic_coach"). Re-navigating to the current hash is a no-op. */
export function navigate(path: string) {
  const enc = path
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  if (window.location.hash !== '#' + enc) window.location.hash = enc
}
