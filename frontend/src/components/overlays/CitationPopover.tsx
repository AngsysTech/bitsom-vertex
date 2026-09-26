import { useWS } from '@/store/workspace'

/** Hover preview for a citation pill: source + verified quote. */
export function CitationPopover() {
  const pop = useWS((s) => s.pop)
  if (!pop) return null
  const c = pop.citation
  return (
    <div
      className="pointer-events-none fixed z-[1000] flex w-80 flex-col gap-1.5 rounded-lg border border-line bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,.18)]"
      style={{ left: pop.x, top: pop.y, transform: pop.up ? 'translateY(-100%)' : undefined }}
    >
      <span className="text-xs font-bold text-ink-5">
        {c.docTitle} › {c.sectionHeading}
      </span>
      <span className="text-[13px] leading-[19px] text-ink">“{c.quote}”</span>
      <span className="text-[11px] text-ink-4">Click to open the source</span>
    </div>
  )
}
