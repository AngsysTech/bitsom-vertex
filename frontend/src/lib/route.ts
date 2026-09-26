// Hash routes (static-host friendly):
//   #/dm/:agentId  #/channel/:id  #/calendar  #/files  #/files/:docId[/:sectionId]  #/agents  #/advisor
//   #/class/:courseCode[/lectures[/:lectureId[/:segmentId]] | /schedule]
import type { AgentId } from '@/types'
import { DEFAULT_AGENT } from './config'

export type ClassTab = 'messages' | 'lectures' | 'schedule'

export type Route =
  | { view: 'dm'; id: AgentId }
  | { view: 'channel'; id: string }
  | { view: 'class'; id: string; tab: ClassTab; lecture: string | null; seg: string | null }
  | { view: 'calendar' }
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
  const [v, a, b, c, d] = hash.replace(/^#\/?/, '').split('/').map(dec)
  if (v === 'dm' && a) return { view: 'dm', id: a as AgentId }
  if (v === 'channel') return { view: 'channel', id: a || 'announcements' }
  if (v === 'class' && a) {
    const tab: ClassTab = b === 'lectures' || b === 'schedule' ? b : 'messages'
    return { view: 'class', id: a, tab, lecture: tab === 'lectures' ? c || null : null, seg: tab === 'lectures' ? d || null : null }
  }
  if (v === 'calendar') return { view: 'calendar' }
  if (v === 'files' && a) return { view: 'doc', id: a, sec: b || null }
  if (v === 'files') return { view: 'files' }
  if (v === 'agents') return { view: 'agents' }
  if (v === 'advisor') return { view: 'advisor' }
  return { view: 'dm', id: DEFAULT_AGENT }
}

/** Identity of the pane: tabs inside a class channel keep the same key. */
export const routeKey = (r: Route) => ('id' in r ? `${r.view}:${r.id}` : r.view)

/** Navigate by path ("/dm/academic_coach"). Re-navigating to the current hash is a no-op. */
export function navigate(path: string) {
  const enc = path
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  if (window.location.hash !== '#' + enc) window.location.hash = enc
}

export const classPath = (courseCode: string, tab: ClassTab = 'messages', lectureId?: string, segmentId?: string) =>
  `/class/${courseCode}` + (tab === 'messages' ? '' : `/${tab}`) + (lectureId ? `/${lectureId}` : '') + (segmentId ? `/${segmentId}` : '')
