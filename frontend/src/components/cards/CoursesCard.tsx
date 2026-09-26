import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import type { Citation, CoursesCard as CoursesCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

export function CoursesCard({ card, citations }: { card: CoursesCardT; citations: Citation[] }) {
  return (
    <CardShell className="gap-1">
      <CardLabel className="mb-1.5">Courses · Sem {card.forSemester}</CardLabel>
      {card.items.map((c) => (
        <div key={c.code} className="flex flex-col gap-[5px] border-t border-line py-[9px]">
          <div className="flex justify-between gap-2 text-[13px]">
            <span>
              <b>{c.code}</b> {c.title}
            </span>
            <span className="flex-none text-ink-5">{c.units} units</span>
          </div>
          <div className="text-xs text-ink-5">
            {c.slot} · {c.faculty}
          </div>
          {c.why && <div className="text-xs leading-[17px] text-ink">{c.why}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-5 items-center rounded-full border border-line bg-white px-2 text-[11px]">fills: {c.fillsBucket}</span>
            {c.clashesWith && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full border border-bad bg-white px-2 text-[11px]">
                <Icon name="warning" size={13} className="text-bad" />
                Clashes with {c.clashesWith}
              </span>
            )}
            <CitePills ids={c.citationIds} citations={citations} />
          </div>
        </div>
      ))}
    </CardShell>
  )
}
