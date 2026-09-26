import { CitePills } from '@/components/CitePill'
import { asPercent } from '@/lib/format'
import type { Citation, WeakTopicsCard as WeakTopicsCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

export function WeakTopicsCard({ card, citations }: { card: WeakTopicsCardT; citations: Citation[] }) {
  const items = [...card.items].sort((a, b) => b.impact - a.impact)
  const max = Math.max(...items.map((t) => t.impact), 0) || 1
  return (
    <CardShell>
      <CardLabel>Weak topics · by impact</CardLabel>
      {items.map((t) => (
        <div key={`${t.course}:${t.topic}`} className="flex flex-col gap-1">
          <div className="flex justify-between gap-2 text-[13px]">
            <span>
              <span className="text-ink-5">{t.course} ·</span> <b>{t.topic}</b>
              <CitePills ids={[t.citationId]} citations={citations} />
            </span>
            <b className="flex-none">{t.score}</b>
          </div>
          <div className="flex items-center gap-2" data-tip={`Impact ${t.impact}`}>
            <div className="h-1 flex-1 overflow-hidden rounded-sm bg-line">
              <div className="h-full bg-ink" style={{ width: `${Math.round((t.impact / max) * 100)}%` }} />
            </div>
            <span className="flex-none text-[11px] text-ink-5">{asPercent(t.examWeight)}% of paper</span>
          </div>
        </div>
      ))}
    </CardShell>
  )
}
