import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { MakeRelevantButton, RelevantSlot } from '@/components/relevant/MakeRelevant'
import { fmtMinutes } from '@/lib/format'
import { mondayOf, weekLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Citation, StudyPlanCard as StudyPlanCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

/** Default tab: this week if the plan has it, else the first week. */
export function currentWeekIndex(card: StudyPlanCardT) {
  const i = card.weeks.findIndex((w) => w.label === weekLabel(mondayOf(new Date())))
  return i >= 0 ? i : 0
}

export function StudyPlanCard({ card, citations, title = 'Study plan' }: { card: StudyPlanCardT; citations: Citation[]; title?: string }) {
  const planWeek = useWS((s) => s.planWeek)
  const set = useWS((s) => s.set)
  const wi = Math.max(0, Math.min(planWeek ?? currentWeekIndex(card), card.weeks.length - 1))
  const week = card.weeks[wi]
  const total = week?.blocks.reduce((n, b) => n + b.minutes, 0) ?? 0
  return (
    <CardShell>
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>{title}</CardLabel>
        {week && (
          <span className="text-xs text-ink-5">
            {week.blocks.length} blocks · {fmtMinutes(total)}
          </span>
        )}
      </div>
      {!card.weeks.length && <span className="text-[13px] text-ink-5">No blocks planned yet.</span>}
      <div className="flex flex-wrap gap-1.5">
        {card.weeks.map((w, i) => (
          <button
            key={w.label}
            type="button"
            onClick={() => set({ planWeek: i })}
            className={cn('h-[26px] cursor-pointer rounded-full border px-3 text-xs font-bold', i === wi ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}
          >
            {w.label}
          </button>
        ))}
      </div>
      {week?.examNote && (
        <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Icon name="event" size={14} className="text-bad" />
          {week.examNote}
        </div>
      )}
      <div>
        {week?.blocks.map((b) => (
          <div key={b.id} className="border-t border-line py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[13px] leading-[19px]">
              <span className="flex flex-col gap-0.5">
                <b>{b.topic}</b>
                <span className="text-xs text-ink-5">
                  {b.course} · {b.why}
                  {b.citationId && <CitePills ids={[b.citationId]} citations={citations} className="ml-1" />}
                </span>
              </span>
              <span className="flex flex-none items-start gap-1 text-xs text-ink-5">
                {b.minutes} min
                <MakeRelevantButton source={{ type: 'plan_block', planBlockId: b.id }} variant="icon" className="-mt-0.5" />
              </span>
            </div>
            <RelevantSlot source={{ type: 'plan_block', planBlockId: b.id }} className="mt-2" />
          </div>
        ))}
      </div>
    </CardShell>
  )
}
