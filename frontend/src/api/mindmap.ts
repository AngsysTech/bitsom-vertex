// Lecture mind map API (contracts.ts v3.9): GET /lectures/:id/mindmap, POST …/mindmap/rebuild,
// and POST /relevant for Make it relevant on a node. Kept in its own module so the shared
// `Api` interface (client.ts / http.ts) is untouched. MOCK=true serves mock/mindmap.json.
// Built 26 Sep 2026.
import { API_URL, MOCK } from '@/lib/config'
import type { RelevantCard, StudentId } from '@/types'
import { ApiError } from './client'

// Mirrors contracts.ts v3.9. src/types.ts is still the v2 copy; import these from '@/types'
// once `npm run sync-types` has run.
export type MindMapNodeKind = 'root' | 'section' | 'point' | 'ghost_missed'

export interface MindMapNode {
  id: string
  kind: MindMapNodeKind
  label: string // section heading / key point / missed topic
  parentId?: string
  handoutSectionId?: string // section + point nodes
  syllabusSectionId?: string // section (when mapped) and ghost nodes
  segmentIds?: string[] // provenance; first one is the "jump to" target
  flags: {
    stuck?: { markerIds: string[]; atSec: number[] }
    emphasized?: { quote: string; segmentId: string }
    missed?: { why: string } // ghost nodes only
    reviewActionId?: string // an action already exists for this node
  }
  order: number
}

export interface MindMap {
  lectureId: string
  courseCode: string
  builtAt: string
  nodes: MindMapNode[] // tree via parentId; root has none
  stats: { sections: number; points: number; stuck: number; missed: number; emphasized: number }
}

export type RelevantSource =
  | { type: 'handout_section'; lectureId: string; sectionId: string; markerId?: string }
  | { type: 'weak_topic'; course: string; topic: string }

export type RelevantResult = RelevantCard & { source?: RelevantSource }

const enc = encodeURIComponent

async function req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Can't reach the backend at ${API_URL}`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? data?.detail ?? `${res.status} ${res.statusText}`)
  return data as T
}

/** The mock is imported on first use, so real mode never loads it. */
const mock = () => import('./mock/mindmap.json').then((m) => m.default as unknown as MockFile)

interface MockFile {
  mindmap: MindMap
  segmentStarts: Record<string, number>
}

export function getMindMap(lectureId: string): Promise<MindMap> {
  if (MOCK) return mock().then((m) => ({ ...m.mindmap, lectureId }))
  return req('GET', `/lectures/${enc(lectureId)}/mindmap`)
}

export function rebuildMindMap(lectureId: string): Promise<MindMap> {
  if (MOCK) return mock().then((m) => ({ ...m.mindmap, lectureId, builtAt: new Date().toISOString() }))
  return req('POST', `/lectures/${enc(lectureId)}/mindmap/rebuild`)
}

/** segmentId → start second, for the mm:ss chip on an exam hint. Display only. */
export async function getSegmentStarts(lectureId: string): Promise<Record<string, number>> {
  if (MOCK) return mock().then((m) => m.segmentStarts)
  const t = await req<{ segments: { id: string; startSec: number }[] }>('GET', `/lectures/${enc(lectureId)}/transcript`)
  return Object.fromEntries(t.segments.map((s) => [s.id, s.startSec]))
}

export function makeItRelevant(body: { studentId: StudentId; interest?: string; source: RelevantSource }): Promise<RelevantResult> {
  if (MOCK) {
    const concept = body.source.type === 'handout_section' ? body.source.sectionId : body.source.topic
    return Promise.resolve({
      type: 'relevant',
      concept,
      course: body.source.type === 'weak_topic' ? body.source.course : '',
      interest: body.interest ?? 'your interest',
      standard: 'Mock mode: the backend builds this from the handout section with POST /relevant.',
      reframed: 'Switch MOCK off (?mock=0) to see the same facts reframed.',
      citationIds: [],
      source: body.source,
    })
  }
  return req('POST', '/relevant', body)
}
