import { CitePills } from '@/components/CitePill'
import type { Citation, PicksCard as PicksCardT } from '@/types'
import { CardLabel } from './shared'

export function PicksCard({ card, citations }: { card: PicksCardT; citations: Citation[] }) {
  return (
    <section className="flex flex-col gap-2">
      <CardLabel>Picks for you</CardLabel>
      {card.items.map((p) => (
        <div key={p.name} className="flex flex-col gap-[5px] rounded-lg border border-line bg-soft px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[10px] font-bold tracking-[.05em] text-ink-5 uppercase">{p.kind}</span>
            {p.wildcard && <span className="rounded bg-cyan px-1.5 py-0.5 text-[10px] font-bold tracking-[.05em] text-ink uppercase">Wildcard</span>}
            <span className="ml-auto">
              <CitePills ids={p.citationIds} citations={citations} />
            </span>
          </div>
          <b className="text-sm">{p.name}</b>
          {p.when && <span className="text-xs text-ink-5">{p.when}</span>}
          <span className="text-[13px] leading-[19px]">{p.why}</span>
          {p.anecdote && <span className="text-[13px] leading-[19px] text-ink-5 italic">{p.anecdote}</span>}
        </div>
      ))}
    </section>
  )
}
