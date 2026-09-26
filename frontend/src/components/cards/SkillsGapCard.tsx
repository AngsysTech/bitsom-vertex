import { CitePills } from '@/components/CitePill'
import type { Citation, SkillsGapCard as SkillsGapCardT } from '@/types'
import { STATUS_COLOR } from '@/lib/labels'
import { CardLabel, CardShell, Dot } from './shared'

export function SkillsGapCard({ card, citations }: { card: SkillsGapCardT; citations: Citation[] }) {
  const groups = [
    { title: 'Covered', color: STATUS_COLOR.ok, items: card.covered.map((x) => ({ label: x.skill, tip: `via ${x.via}` })) },
    { title: 'Covered after plan', color: STATUS_COLOR.gap, items: card.coveredAfterPlan.map((x) => ({ label: x.skill, tip: `via ${x.via}` })) },
    { title: 'Missing', color: STATUS_COLOR.at_risk, items: card.missing.map((x) => ({ label: x, tip: undefined })) },
  ]
  return (
    <CardShell>
      <CardLabel>Skills gap</CardLabel>
      <div className="flex items-center gap-1 text-[15px] font-bold">
        {card.role}
        <CitePills ids={card.citationIds} citations={citations} />
      </div>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-bold">
            <Dot color={g.color} />
            {g.title} <span className="font-normal text-ink-5">{g.items.length}</span>
          </span>
          <div className="flex flex-wrap gap-1.5 pl-3.5">
            {g.items.map((it) => (
              <span
                key={it.label}
                data-tip={it.tip}
                className="inline-flex h-[22px] items-center rounded-full border bg-white px-[9px] text-xs"
                style={{ borderColor: g.color }}
              >
                {it.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </CardShell>
  )
}
