import type { ReactNode } from 'react'
import { useWS } from '@/store/workspace'
import { cn } from '@/lib/utils'
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

/** Pills for a list of citation ids, resolved against the carrying message's citations. Unknown ids render nothing. */
export function CitePills({ ids, citations }: { ids: (string | undefined)[]; citations: Citation[] }) {
  const found = ids.map((id) => citations.find((c) => c.id === id)).filter((c): c is Citation => !!c)
  if (!found.length) return null
  return (
    <span className="inline-flex flex-none gap-1">
      {found.map((c) => (
        <CitePill key={c.id} citation={c} className="mx-0" />
      ))}
    </span>
  )
}
