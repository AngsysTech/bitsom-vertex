// Lecture mind map API (contracts.ts v3.9): GET /lectures/:id/mindmap and POST …/mindmap/rebuild.
// Kept in its own module so the shared `Api` interface (client.ts / http.ts) is untouched.
// MOCK=true builds the map from the mock lecture's own handout and cards (see mockMap).
// Built 26 Sep 2026.
import { API_URL, MOCK } from '@/lib/config'
import type { ActionsCard, CoverageCard, Handout, HandoutSection, StuckMarker } from '@/types'
import { ApiError } from './client'
import { api } from './index'

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

// ---- MOCK=true ---------------------------------------------------------------------------------
// The same tree and overlay as backend/app/tools/mindmap.py, over the mock server's handout and
// cards, so the rehearsal map always matches the rehearsal handout (and its stuck markers). A
// lecture the mock server doesn't have (e.g. a harness id) gets the static mock/mindmap.json.

const STATUS_RANK: Record<string, number> = { accepted: 0, done: 0, proposed: 1 }
const KIND_RANK: Record<string, number> = { review: 0, study: 1, prep: 2, ask: 3, resource: 4, deadline: 5 }

function syllabusKey(id?: string): [string, number[]] | null {
  if (!id) return null
  const parts = id.split('.')
  const nums: number[] = []
  while (parts.length && /^\d+$/.test(parts[parts.length - 1]!)) nums.unshift(Number(parts.pop()))
  return nums.length ? [parts.join('.'), nums] : null
}

const lexLess = (a: readonly (number | string)[], b: readonly (number | string)[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return a.length < b.length
}

export function buildMindMap(handout: Handout, coverage: CoverageCard, actions: ActionsCard, markers: StuckMarker[]): MindMap {
  const sections = handout.sections
  const ids = new Set(sections.map((x) => x.id))
  const segSection = new Map<string, string>()
  for (const x of sections) for (const g of x.segmentIds) if (!segSection.has(g)) segSection.set(g, x.id)

  const stuck = new Map<string, { markerIds: string[]; atSec: number[] }>()
  const flag = (sid: string | undefined, mid: string | undefined, at: number | undefined) => {
    if (!sid || !ids.has(sid) || !mid || at == null) return
    const e = stuck.get(sid) ?? { markerIds: [], atSec: [] }
    if (!e.markerIds.includes(mid)) {
      e.markerIds.push(mid)
      e.atSec.push(at)
    }
    stuck.set(sid, e)
  }
  for (const x of sections) x.stuck?.markerIds.forEach((m, i) => flag(x.id, m, x.stuck!.atSec[i]))
  for (const c of coverage.confusion ?? []) flag(c.handoutSectionId, c.markerId, c.atSec)
  for (const m of markers) flag(m.handoutSectionId ?? segSection.get(m.segmentId ?? ''), m.id, m.atSec)

  const emphasized = new Map<string, { quote: string; segmentId: string }>()
  for (const e of coverage.emphasized) {
    const sid = segSection.get(e.segmentId)
    if (sid && !emphasized.has(sid)) emphasized.set(sid, { quote: e.quote, segmentId: e.segmentId })
  }

  const actionFor = (markerIds: string[], syllabusId?: string) => {
    let best: (number | string)[] | undefined
    actions.items.forEach((a, pos) => {
      if (!(a.status in STATUS_RANK)) return
      const src = a.provenance.markerId && markerIds.includes(a.provenance.markerId) ? 0 : syllabusId && a.provenance.syllabusSectionId === syllabusId ? 1 : -1
      if (src < 0) return
      const rank = [src, STATUS_RANK[a.status]!, KIND_RANK[a.kind] ?? 9, pos, a.id]
      if (!best || lexLess(rank, best)) best = rank
    })
    return best?.[4] as string | undefined
  }

  type Child = { kind: 'section'; s: HandoutSection } | { kind: 'ghost'; m: CoverageCard['missed'][number]; id: string }
  const children: Child[] = sections.map((x) => ({ kind: 'section', s: x }))
  const used = new Set<string>()
  for (const m of coverage.missed) {
    let id = `miss:${m.syllabusSectionId}`
    while (used.has(id)) id += '+'
    used.add(id)
    const key = syllabusKey(m.syllabusSectionId)
    let at = children.length
    if (key) {
      const keys = children.map((c) => syllabusKey(c.kind === 'section' ? c.s.syllabusSectionId : c.m.syllabusSectionId))
      const prior = keys.flatMap((k, i) => (k && k[0] === key[0] && lexLess(k[1], key[1]) ? [i] : []))
      const same = keys.flatMap((k, i) => (k && k[0] === key[0] ? [i] : []))
      at = prior.length ? prior[prior.length - 1]! + 1 : same.length ? same[0]! : children.length
    }
    children.splice(at, 0, { kind: 'ghost', m, id })
  }

  const rootId = `root:${handout.lectureId}`
  const nodes: MindMapNode[] = [{ id: rootId, kind: 'root', label: handout.title, flags: {}, order: 0 }]
  children.forEach((c, order) => {
    if (c.kind === 'ghost') {
      const act = actionFor([], c.m.syllabusSectionId)
      nodes.push({ id: c.id, kind: 'ghost_missed', label: c.m.topic, parentId: rootId, syllabusSectionId: c.m.syllabusSectionId,
        flags: { missed: { why: c.m.why }, ...(act ? { reviewActionId: act } : {}) }, order })
      return
    }
    const x = c.s
    const st = stuck.get(x.id)
    const em = emphasized.get(x.id)
    const act = actionFor(st?.markerIds ?? [], x.syllabusSectionId)
    nodes.push({
      id: `sec:${x.id}`, kind: 'section', label: x.heading, parentId: rootId, handoutSectionId: x.id,
      ...(x.syllabusSectionId ? { syllabusSectionId: x.syllabusSectionId } : {}),
      ...(x.segmentIds.length ? { segmentIds: x.segmentIds } : {}),
      flags: { ...(st ? { stuck: st } : {}), ...(em ? { emphasized: em } : {}), ...(act ? { reviewActionId: act } : {}) },
      order,
    })
    x.keyPoints.forEach((kp, n) => nodes.push({ id: `pt:${x.id}:${n}`, kind: 'point', label: kp, parentId: `sec:${x.id}`, handoutSectionId: x.id, flags: {}, order: n }))
  })

  const count = (f: (n: MindMapNode) => boolean) => nodes.filter(f).length
  return {
    lectureId: handout.lectureId,
    courseCode: handout.courseCode,
    builtAt: new Date().toISOString(),
    nodes,
    stats: {
      sections: count((n) => n.kind === 'section'),
      points: count((n) => n.kind === 'point'),
      stuck: count((n) => !!n.flags.stuck),
      missed: count((n) => n.kind === 'ghost_missed'),
      emphasized: count((n) => !!n.flags.emphasized),
    },
  }
}

/** The static fallback is imported on first use, so real mode never loads it. */
const staticMock = () => import('./mock/mindmap.json').then((m) => m.default as unknown as MindMap)

async function mockMap(lectureId: string): Promise<MindMap> {
  let parts: [Handout, { coverage: CoverageCard; actions: ActionsCard }, StuckMarker[]]
  try {
    parts = await Promise.all([api.getHandout(lectureId), api.getLectureCards(lectureId), api.getMarkers(lectureId)])
  } catch {
    return staticMock().then((m) => ({ ...m, lectureId, builtAt: new Date().toISOString() }))
  }
  return buildMindMap(parts[0], parts[1].coverage, parts[1].actions, parts[2])
}

export function getMindMap(lectureId: string): Promise<MindMap> {
  if (MOCK) return mockMap(lectureId)
  return req('GET', `/lectures/${enc(lectureId)}/mindmap`)
}

export function rebuildMindMap(lectureId: string): Promise<MindMap> {
  if (MOCK) return mockMap(lectureId)
  return req('POST', `/lectures/${enc(lectureId)}/mindmap/rebuild`)
}
