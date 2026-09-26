import { CitePills } from '@/components/CitePill'
import { Markdown } from '@/components/Markdown'
import type { Citation, RelevantCard as RelevantCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

export function RelevantCard({ card, citations }: { card: RelevantCardT; citations: Citation[] }) {
  return (
    <CardShell>
      <div className="flex items-center justify-between gap-2">
        <CardLabel>Make it relevant · {card.concept}</CardLabel>
        <CitePills ids={card.citationIds} citations={citations} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-[13px] leading-[19px]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <b>Standard</b>
          <Markdown text={card.standard} citations={citations} className="text-ink-5" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 border-l border-line pl-3">
          <b>Through {card.interest}</b>
          <Markdown text={card.reframed} citations={citations} />
        </div>
      </div>
    </CardShell>
  )
}
