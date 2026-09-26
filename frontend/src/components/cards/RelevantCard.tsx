import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/utils'
import { relevantKey, useWS } from '@/store/workspace'
import type { Citation, RelevantCard as RelevantCardT } from '@/types'
import { CardLabel } from './shared'

/** Make it Relevant, side by side: the grounded explanation (muted) next to the same facts through an interest. */
export function RelevantCard({ card, citations, onClose, className }: { card: RelevantCardT; citations: Citation[]; onClose?: () => void; className?: string }) {
  const interests = useWS((s) => s.students.find((x) => x.id === s.studentId)?.interests ?? [])
  const busy = useWS((s) => (card.source ? s.relevant[relevantKey(card.source)]?.status === 'loading' : false))
  const makeRelevant = useWS((s) => s.makeRelevant)
  const next = interests.length > 1 ? interests[(interests.indexOf(card.interest) + 1) % interests.length] : undefined
  return (
    <section className={cn('flex flex-col gap-2.5 rounded-lg border border-line bg-white px-4 py-3.5', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardLabel>Make it relevant</CardLabel>
          <b className="text-[15px] leading-[20px]">
            {card.concept} <span className="font-normal text-ink-5">· {card.course}</span>
          </b>
        </div>
        <div className="flex flex-none items-center gap-1">
          {card.source && next && (
            <button
              type="button"
              disabled={busy}
              onClick={() => card.source && void makeRelevant(relevantKey(card.source), card.source, next)}
              data-tip={`Same facts through ${next}`}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs font-bold text-ink hover:bg-soft disabled:cursor-wait disabled:opacity-60"
            >
              <Icon name="autorenew" size={15} />
              Try another
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-5 hover:bg-soft">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[13px] leading-[19px]">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md bg-mist px-3 py-2.5">
          <span className="text-[10px] font-bold tracking-[.08em] text-ink-5 uppercase">Standard</span>
          <Markdown text={card.standard} citations={citations} className="text-ink-5 [&_ul]:pl-4" />
          <CitePills ids={card.citationIds} citations={citations} className="mt-0.5" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-cyan bg-cyan-soft px-3 py-2.5">
          <span className="text-[10px] font-bold tracking-[.08em] text-ink uppercase">Through {card.interest}</span>
          <Markdown text={card.reframed} citations={citations} className="text-ink [&_ul]:pl-4" />
        </div>
      </div>
      <span className="flex items-center gap-1 text-[11px] text-ink-5">
        <Icon name="verified" size={13} />
        Same facts, reframed through {card.interest} — nothing new is added.
      </span>
    </section>
  )
}
