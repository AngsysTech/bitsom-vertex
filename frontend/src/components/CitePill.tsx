import type { ReactNode } from 'react'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Citation } from '@/types'

/** Inline citation marker. Hover previews the quote; click opens the source. */
export function CitePill({ citation, children, className }: { citation: Citation; children?: ReactNode; className?: string }) {
  const showPop = useWS((s) => s.showPop)
  const hidePop = useWS((s) => s.hidePop)
  const openCitation = useWS((s) => s.openCitation)
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Source ${citation.id}: ${citation.docTitle} › ${citation.sectionHeading}`}
      className={cn(
        'mx-0.5 inline-flex h-[18px] cursor-pointer items-center rounded-full border border-cyan bg-cyan-soft px-1.5 align-[1px] text-[11px] leading-none font-bold text-ink',
        className,
      )}
      onMouseEnter={(e) => showPop(citation, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={hidePop}
      onClick={(e) => {
        e.stopPropagation()
        openCitation(citation)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openCitation(citation)
        }
      }}
    >
      {children ?? citation.id}
    </span>
  )
}

/** Section ids follow the backend parser: syllabus.cs-f212.3.5, past_papers.cs-f212.b-trees, handbook.3.2 … */
export function docIdOf(sectionId: string) {
  const parts = sectionId.split('.')
  return parts[0] === 'syllabus' || parts[0] === 'circular' ? parts.slice(0, 2).join('.') : parts[0]!
}

export function sectionLabel(sectionId: string) {
  const parts = sectionId.split('.')
  switch (parts[0]) {
    case 'syllabus':
      return `Syllabus ${parts.slice(2).join('.')}`.trim()
    case 'past_papers':
      return 'Past papers'
    case 'exam_calendar':
      return 'Exam calendar'
    case 'handbook':
      return `Handbook §${parts.slice(1).join('.')}`
    case 'circular':
      return 'Circular'
    case 'catalog':
      return 'Catalog'
    default:
      return sectionId
  }
}

/**
 * A source given only by its section id (cards from StudentState, RelevantCard, coverage, actions): the
 * chip names the section; hover previews the section's own text once loaded; click opens it.
 */
export function SectionChip({ sectionId, className }: { sectionId: string; className?: string }) {
  const docId = docIdOf(sectionId)
  const entry = useWS((s) => s.docs[docId])
  const loadDoc = useWS((s) => s.loadDoc)
  const showPop = useWS((s) => s.showPop)
  const hidePop = useWS((s) => s.hidePop)
  const openCitation = useWS((s) => s.openCitation)
  const set = useWS((s) => s.set)
  const doc = entry?.status === 'ready' ? entry.doc : undefined
  const sec = doc?.sections.find((x) => x.id === sectionId)
  const cite: Citation | undefined =
    doc && sec ? { id: sectionLabel(sectionId), docId, docTitle: doc.title, sectionId, sectionHeading: sec.heading, quote: sec.text.split(/(?<=[.!?])\s+/)[0] ?? sec.text } : undefined
  const open = () => {
    if (cite) return openCitation(cite)
    set({ focusCite: null })
    navigate(`/files/${docId}/${sectionId}`)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Source ${sectionLabel(sectionId)}`}
      className={cn(
        'mx-0.5 inline-flex h-[18px] cursor-pointer items-center gap-0.5 rounded-full border border-cyan bg-white px-1.5 align-[1px] text-[11px] leading-none font-bold whitespace-nowrap text-ink hover:bg-cyan-soft',
        className,
      )}
      onMouseEnter={(e) => {
        loadDoc(docId)
        if (cite) showPop(cite, e.currentTarget.getBoundingClientRect())
      }}
      onMouseLeave={hidePop}
      onClick={(e) => {
        e.stopPropagation()
        open()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      {sectionLabel(sectionId)}
    </span>
  )
}

/**
 * Pills for card citation ids. An id resolves against the carrying message's citations (by id, or by
 * sectionId — backend cards carry section ids); a bare section id becomes a SectionChip; anything else
 * renders nothing (never invented).
 */
export function CitePills({ ids, citations, className }: { ids: (string | undefined)[]; citations: Citation[]; className?: string }) {
  const seen = new Set<string>()
  const out: ReactNode[] = []
  for (const id of ids) {
    if (!id) continue
    const c = citations.find((x) => x.id === id) ?? citations.find((x) => x.sectionId === id)
    const key = c ? `c:${c.id}` : `s:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (c) out.push(<CitePill key={key} citation={c} className="mx-0" />)
    else if (id.includes('.')) out.push(<SectionChip key={key} sectionId={id} className="mx-0" />)
  }
  if (!out.length) return null
  return <span className={cn('inline-flex flex-none flex-wrap gap-1 align-middle', className)}>{out}</span>
}
