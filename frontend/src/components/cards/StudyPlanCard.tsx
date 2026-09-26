import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { fmtMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Citation, StudyPlanCard as StudyPlanCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

export function StudyPlanCard({ card, citations }: { card: StudyPlanCardT; citations: Citation[] }) {
  const planWeek = useWS((s) => s.planWeek)
  const set = useWS((s) => s.set)
  const wi = Math.max(0, Math.min(planWeek, card.weeks.length - 1))
  const week = card.weeks[wi]
  const total = week?.blocks.reduce((n, b) => n + b.minutes, 0) ?? 0
  return (
    <CardShell>
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>Study plan</CardLabel>
        {week && (
          <span className="text-xs text-ink-5">
            {week.blocks.length} blocks · {fmtMinutes(total)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {card.weeks.map((w, i) => (
          <button
            key={w.label}
            type="button"
            onClick={() => set({ planWeek: i })}
            className={cn(
              'h-[26px] cursor-pointer rounded-full border px-3 text-xs font-bold',
              i === wi ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>
      {week?.examNote && (
        <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Icon name="event" size={14} className="text-ink-5" />
          {week.examNote}
        </div>
      )}
      <div>
        {week?.blocks.map((b) => (
          <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-line py-2 text-[13px] leading-[19px]">
            <span className="flex flex-col gap-0.5">
              <b>{b.topic}</b>
              <span className="text-xs text-ink-5">
                {b.course} · {b.why}
                {b.citationId && <CitePills ids={[b.citationId]} citations={citations} />}
              </span>
            </span>
            <span className="text-xs text-ink-5">{b.minutes} min</span>
          </div>
        ))}
      </div>
    </CardShell>
  )
}
