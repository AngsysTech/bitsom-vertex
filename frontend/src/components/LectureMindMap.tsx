// Lecture mind map (contracts.ts v3.9, AGENTS.md §9.6): the handout as a tree, with the coverage
// overlay drawn on it. That means stuck flags, exam hints and a tick where a review already exists.
// Ghost nodes for skipped syllabus topics are filtered out: the map doesn't grade the lecture. It
// renders the jury-approved vendored component (src/vendored/mindmap/, see its NOTICE) and restyles
// it from the outside. Everything
// in this file was written 26 Sep 2026. It shows only what GET /lectures/:id/mindmap returns.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { getMindMap, rebuildMindMap, type MindMap, type MindMapNode } from '@/api/mindmap'
import { docIdOf } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { MakeRelevantButton, RelevantSlot } from '@/components/relevant/MakeRelevant'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { isLectureGone, relevantKey, useWS } from '@/store/workspace'
import type { RelevantCard } from '@/types'
// @ts-expect-error vendored JS (prior code, jury-approved) ships without type declarations
import MindMapGraphJs from '@/vendored/mindmap/MindMapGraph.jsx'
// @ts-expect-error vendored JS (prior code, jury-approved) ships without type declarations
import { expandedForPath, indexProjection, initialExpanded, retainState, searchNodes } from '@/vendored/mindmap/mindMap.js'

/** The map shows what the lecture taught. We don't grade the lecture, so syllabus topics it left out
 *  (ghost nodes) stay off the UI; they still become study actions in the Actions card. */
const taught = (m: MindMap): MindMap => ({ ...m, nodes: m.nodes.filter((n) => n.kind !== 'ghost_missed') })

// ---- the vendored component's shapes, as far as this file uses them ------------------------

interface Index {
  byId: Map<string, unknown>
  rootIds: string[]
}

const MindMapGraph = MindMapGraphJs as ComponentType<{
  index: Index
  expanded: Set<string>
  selectedId: string | null
  matchedIds?: string[]
  onToggle: (id: string) => void
  onSelect: (id: string | null) => void
  onExpandAll?: () => void
  onCollapseAll?: () => void
  className?: string
}>

// Our kinds onto the vendored ones. A ghost keeps its own kind so the overlay CSS can find it.
const KIND = { root: 'SCOPE_ROOT', section: 'SOURCE_NODE', point: 'SOURCE_NODE', ghost_missed: 'GHOST_MISSED' } as const

function toProjection(map: MindMap) {
  return {
    projection_id: `${map.lectureId}@${map.builtAt}`,
    nodes: map.nodes.map((n) => ({ mindmap_node_id: n.id, kind: KIND[n.kind], label: n.label })),
    edges: map.nodes
      .filter((n) => n.parentId)
      .map((n) => ({ from_node_id: n.parentId, to_node_id: n.id, ordinal: n.order })),
    root_node_ids: map.nodes.filter((n) => n.kind === 'root').map((n) => n.id),
  }
}

// ---- theme: our tokens over the vendored component, from outside (no fork) -----------------

const BASE_CSS = `
.lmm { font-family: Lato, system-ui, sans-serif; }
.lmm [data-testid="mindmap-graph"] { background: #fff; }
.lmm [data-testid="mindmap-graph"] > div:first-child { background-image: radial-gradient(rgba(15,23,42,.10) 1px, transparent 1.4px) !important; }
.lmm .mindmap-node { background-color: #fff; border-color: #e2e8f0; color: #0f172a; }
.lmm .mindmap-node[data-level="1"] { border-color: #cbd5e1; }
.lmm [data-level="0"] { background: #fff; border: 2px solid #0f172a; color: #0f172a; box-shadow: none; }
.lmm .mindmap-branch { stroke: #22d3ee; }
.lmm .mindmap-toggle { background: #fff; border-color: #cbd5e1; color: #0f172a; }
.lmm [role="treeitem"][aria-selected="true"] > [data-level] { --tw-ring-color: #22d3ee; }
.lmm [role="treeitem"] { padding: 10px 0; } /* room for the badges; the layout measures it, so siblings space out */
`

const BADGE =
  'position:absolute;z-index:2;padding:0 6px;border:1px solid;border-radius:999px;' +
  'font:700 10px/15px Lato,system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;pointer-events:none'

const sel = (id: string) => `.lmm [data-node-id="${id.replace(/["\\]/g, '\\$&')}"]`

/** Per-node overlay rules: badges are pseudo-elements, so the vendored markup stays as it is. */
function overlayCss(map: MindMap): string {
  const out: string[] = []
  for (const n of map.nodes) {
    const box = `${sel(n.id)} > [data-level]`
    const { stuck, emphasized, reviewActionId } = n.flags
    if (n.kind === 'ghost_missed') {
      out.push(`${box}{border:1.5px dashed #f59e0b;background:#fffbeb;color:#92400e}`)
      out.push(`${box}::before{content:"not covered in lecture";${BADGE};left:10px;top:-9px;background:#fffbeb;color:#b45309;border-color:#fcd34d}`)
    }
    if (stuck) {
      const times = stuck.markerIds.length > 1 ? ` ×${stuck.markerIds.length}` : ''
      out.push(`${box}{border-left:3px solid #ef4444}`)
      out.push(`${box}::after{content:"🚩 stuck${times}";${BADGE};right:10px;top:-9px;background:#fef2f2;color:#b91c1c;border-color:#fecaca}`)
    }
    if (emphasized) {
      out.push(`${box}::before{content:"exam hint";${BADGE};left:10px;top:-9px;background:#ecfeff;color:#0e7490;border-color:#67e8f9}`)
    }
    if (reviewActionId) {
      out.push(`${sel(n.id)}::after{content:"✓ review planned";${BADGE};right:14px;bottom:1px;background:#ecfdf5;color:#047857;border-color:#a7f3d0}`)
    }
  }
  return out.join('\n')
}

// ---- small helpers ---------------------------------------------------------------------------

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const KIND_LABEL: Record<MindMapNode['kind'], string> = {
  root: 'Lecture',
  section: 'Handout section',
  point: 'Key point',
  ghost_missed: 'Not covered in lecture',
}

type RelevantSource = NonNullable<RelevantCard['source']>

/** Make it relevant on a section (the handout section) or a ghost (the skipped topic). */
function relevantSource(map: MindMap, n: MindMapNode): RelevantSource | undefined {
  if (n.kind === 'ghost_missed') return { type: 'weak_topic', course: map.courseCode, topic: n.label }
  if (n.kind !== 'section' || !n.handoutSectionId) return undefined
  const markerId = n.flags.stuck?.markerIds[0]
  return { type: 'handout_section', lectureId: map.lectureId, sectionId: n.handoutSectionId, ...(markerId ? { markerId } : {}) }
}

// ---- the Handout | Mind map toggle for the Lectures tab --------------------------------------

export type HandoutPaneView = 'handout' | 'mindmap'

export function HandoutViewToggle({ value, onChange }: { value: HandoutPaneView; onChange: (v: HandoutPaneView) => void }) {
  const views: [HandoutPaneView, string][] = [
    ['handout', 'Handout'],
    ['mindmap', 'Mind map'],
  ]
  return (
    <div role="tablist" aria-label="Lecture view" className="inline-flex rounded-md border border-line bg-soft p-0.5 text-[12px] font-bold">
      {views.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn('cursor-pointer rounded px-2.5 py-1 whitespace-nowrap', value === v ? 'bg-white text-ink shadow-sm' : 'text-ink-5 hover:text-ink')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ---- the map -----------------------------------------------------------------------------------

export function LectureMindMap({
  lectureId,
  onOpenSection,
  className,
}: {
  lectureId: string
  /** Switch to the Handout view scrolled to this section. Without it, a click only selects. */
  onOpenSection?: (handoutSectionId: string) => void
  className?: string
}) {
  const [map, setMap] = useState<MindMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<{ id: string; x: number; y: number; up: boolean } | null>(null)
  const [mir, setMir] = useState<{ label: string; source: RelevantSource } | null>(null)
  const mirOpen = useWS((s) => (mir ? !!s.relevant[relevantKey(mir.source)] : false))
  const [rebuilding, setRebuilding] = useState(false)

  useEffect(() => {
    let live = true
    setMap(null)
    setError(null)
    setMir(null)
    getMindMap(lectureId).then(
      (m) => live && setMap(taught(m)),
      (e: unknown) => {
        if (!live) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        useWS.getState().lectureGone(lectureId, msg)
      },
    )
    return () => {
      live = false
    }
  }, [lectureId, reload])

  // Segment start times, for the exam-hint mm:ss chip only; the map never reads the transcript.
  const transcript = useWS((s) => s.transcripts[lectureId])
  const loadTranscript = useWS((s) => s.loadTranscript)
  useEffect(() => {
    void loadTranscript(lectureId)
  }, [lectureId, loadTranscript])
  const starts = useMemo(() => new Map((transcript?.value?.segments ?? []).map((x) => [x.id, x.startSec])), [transcript])

  const index = useMemo<Index | null>(() => (map ? indexProjection(toProjection(map)) : null), [map])
  const byId = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.id, n])), [map])
  const css = useMemo(() => (map ? overlayCss(map) : ''), [map])

  // A new map keeps what was open; the first one opens the root, so sections and skipped topics show.
  useEffect(() => {
    if (!index || !map) return
    setExpanded((prev) => {
      const kept: Set<string> = retainState(index, prev)
      return kept.size ? kept : initialExpanded(index, 1)
    })
  }, [index, map])

  const matchedIds = useMemo<string[]>(() => (index && query.trim() ? searchNodes(index, query) : []), [index, query])
  useEffect(() => {
    if (!index || !matchedIds.length) return
    setExpanded((prev) => matchedIds.reduce((acc: Set<string>, id) => expandedForPath(index, id, acc), prev))
  }, [index, matchedIds])

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const open = useCallback(
    (n: MindMapNode) => {
      if (n.kind === 'ghost_missed' && n.syllabusSectionId) {
        navigate(`/files/${docIdOf(n.syllabusSectionId)}/${n.syllabusSectionId}`)
      } else if ((n.kind === 'section' || n.kind === 'point') && n.handoutSectionId) {
        onOpenSection?.(n.handoutSectionId)
      }
    },
    [onOpenSection],
  )

  // A click opens the node (the brief); keyboard selection only selects, so arrows can walk the map.
  const pointer = useRef<{ id: string; t: number } | null>(null)
  const onSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      const p = pointer.current
      pointer.current = null
      if (!id || !p || p.id !== id || performance.now() - p.t > 1500) return
      const n = byId.get(id)
      if (n) open(n)
    },
    [byId, open],
  )

  // ---- hover card ----
  const wrapRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const keepHover = () => window.clearTimeout(hideTimer.current)
  const hideHover = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHover(null), 220)
  }
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as Element
    if (target.closest?.('[data-lmm-card]')) return keepHover()
    const el = target.closest?.('[data-node-id]') as HTMLElement | null
    const id = el?.getAttribute('data-node-id')
    const wrap = wrapRef.current
    if (!el || !id || !wrap || byId.get(id)?.kind === 'root') return hideHover()
    keepHover()
    if (hover?.id === id) return
    const box = el.getBoundingClientRect()
    const area = wrap.getBoundingClientRect()
    const up = box.bottom - area.top > area.height * 0.6
    setHover({
      id,
      x: Math.max(8, Math.min(box.left - area.left, area.width - 316)),
      y: up ? area.bottom - box.top + 8 : box.bottom - area.top + 10,
      up,
    })
  }

  const onPointerDownCapture = (e: PointerEvent) => {
    const target = e.target as Element
    if (target.closest?.('[data-lmm-card]')) return
    const id = target.closest?.('[data-node-id]')?.getAttribute('data-node-id')
    pointer.current = id ? { id, t: performance.now() } : null
    setHover(null)
  }

  // ---- actions ----
  const rebuild = async () => {
    setRebuilding(true)
    try {
      setMap(taught(await rebuildMindMap(lectureId)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRebuilding(false)
    }
  }

  // ---- render ----
  if (error && !map) {
    const notReady = /not ready|404/i.test(error)
    const gone = isLectureGone(error)
    return (
      <div className={cn('flex items-center gap-2 px-5 py-4 text-[13px] text-ink-5', className)}>
        <Icon name={notReady ? 'hourglass_top' : 'error'} size={16} className={notReady ? 'text-ink-4' : 'text-bad'} />
        {gone ? (
          <span>This lecture no longer exists: a demo reset removed it.</span>
        ) : notReady ? (
          <span>The mind map appears once the handout is ready.</span>
        ) : (
          <>
            <span>Mind map unavailable —</span>
            <button type="button" onClick={() => setReload((r) => r + 1)} className="cursor-pointer p-0 font-bold text-link">
              try again
            </button>
            <span className="truncate text-xs text-ink-4" title={error}>
              ({error})
            </span>
          </>
        )}
      </div>
    )
  }
  if (!map || !index) {
    return <div className={cn('px-5 py-4 text-[13px] text-ink-5', className)}>Building the mind map…</div>
  }

  const s = map.stats
  const hovered = hover ? byId.get(hover.id) : undefined

  return (
    <div className={cn('lmm flex h-full min-h-[440px] flex-col bg-white', className)}>
      <style>{BASE_CSS + css}</style>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2 text-[12.5px] text-ink-6">
        <span data-testid="mindmap-stats">
          {plural(s.sections, 'section')} · {s.stuck} stuck · {plural(s.emphasized, 'exam hint')}
        </span>
        <span className="flex items-center gap-2.5 text-[11px] text-ink-5">
          <span className="rounded-full border border-red-200 bg-red-50 px-1.5 text-red-700">🚩 stuck</span>
          <span className="rounded-full border border-cyan bg-cyan-soft px-1.5 text-cyan-800">exam hint</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the map"
            aria-label="Search the mind map"
            className="h-7 w-40 rounded-md border border-line bg-soft px-2 text-[12px] text-ink outline-none focus:border-cyan"
          />
          <button
            type="button"
            onClick={rebuild}
            disabled={rebuilding}
            data-tip="Rebuild from the latest handout, cards and markers"
            className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-line bg-white px-2 text-[12px] font-bold text-ink hover:bg-soft disabled:opacity-60"
          >
            <Icon name="refresh" size={15} className={rebuilding ? 'animate-spin' : undefined} />
            Rebuild
          </button>
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1"
        onMouseOver={onMouseOver}
        onMouseLeave={hideHover}
        onPointerDownCapture={onPointerDownCapture}
        onWheelCapture={() => setHover(null)}
      >
        <MindMapGraph
          index={index}
          expanded={expanded}
          selectedId={selectedId}
          matchedIds={matchedIds}
          onToggle={onToggle}
          onSelect={onSelect}
          onExpandAll={() => setExpanded(new Set(map.nodes.filter((n) => n.kind !== 'point').map((n) => n.id)))}
          onCollapseAll={() => setExpanded(new Set(index.rootIds))}
          className="absolute inset-0"
        />

        {hover && hovered && (
          <HoverCard
            node={hovered}
            starts={starts}
            style={hover.up ? { left: hover.x, bottom: hover.y } : { left: hover.x, top: hover.y }}
            onEnter={keepHover}
            onLeave={hideHover}
            onOpen={
              hovered.kind === 'ghost_missed' ? () => open(hovered) : onOpenSection && hovered.handoutSectionId ? () => open(hovered) : undefined
            }
            relevant={relevantSource(map, hovered)}
            onRelevant={(source) => {
              setMir({ label: hovered.label, source })
              setHover(null)
            }}
          />
        )}

        {mir && mirOpen && (
          <div className="absolute bottom-3 left-3 z-20 flex max-h-[60%] w-[min(620px,calc(100%-72px))] flex-col gap-2 overflow-auto rounded-lg border border-line bg-white p-3 shadow-[0_12px_32px_-12px_rgba(15,23,42,.35)]">
            <span className="truncate text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase">Make it relevant · {mir.label}</span>
            <RelevantSlot source={mir.source} />
          </div>
        )}
      </div>
    </div>
  )
}

function HoverCard({
  node,
  starts,
  style,
  onEnter,
  onLeave,
  onOpen,
  relevant,
  onRelevant,
}: {
  node: MindMapNode
  starts: Map<string, number>
  style: CSSProperties
  onEnter: () => void
  onLeave: () => void
  onOpen?: () => void
  relevant?: RelevantSource
  onRelevant: (source: RelevantSource) => void
}) {
  const { stuck, emphasized, missed, reviewActionId } = node.flags
  const at = emphasized ? starts.get(emphasized.segmentId) : undefined
  return (
    <div
      data-lmm-card
      role="dialog"
      aria-label={node.label}
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="absolute z-30 flex w-[300px] flex-col gap-1.5 rounded-lg border border-line bg-white p-3 text-[12.5px] leading-[18px] text-ink shadow-[0_12px_32px_-12px_rgba(15,23,42,.35)]"
    >
      <span className="text-[10.5px] font-bold tracking-[.06em] text-ink-5 uppercase">{KIND_LABEL[node.kind]}</span>
      <span className="font-bold">{node.label}</span>
      {missed && <p className="m-0 text-warn-ink">{missed.why}</p>}
      {emphasized && (
        <div className="flex flex-col gap-1 rounded-md border border-cyan/60 bg-cyan-soft px-2 py-1.5">
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-cyan px-1.5 text-[10px] font-bold text-ink">exam hint</span>
            <span className="font-mono text-[11px] text-ink-5">{at != null ? mmss(at) : emphasized.segmentId}</span>
          </span>
          <q className="text-ink-6 italic">{emphasized.quote}</q>
        </div>
      )}
      {stuck && (
        <span className="text-red-700">
          🚩 You flagged this at {stuck.atSec.map(mmss).join(', ')}
        </span>
      )}
      {reviewActionId && <span className="text-emerald-700">✓ Review planned · in the Actions card</span>}
      {(onOpen || relevant) && (
        <span className="mt-1 flex flex-wrap gap-1.5">
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-[12px] font-bold text-ink hover:bg-soft"
            >
              {node.kind === 'ghost_missed' ? 'Open syllabus section' : 'Open in handout'}
            </button>
          )}
          {relevant && (
            <span onClickCapture={() => onRelevant(relevant)}>
              <MakeRelevantButton source={relevant} />
            </span>
          )}
        </span>
      )}
    </div>
  )
}
