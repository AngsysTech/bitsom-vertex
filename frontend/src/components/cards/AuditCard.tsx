import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { fmtTime } from '@/lib/format'
import type { AuditCard as AuditCardT, Citation } from '@/types'
import { STATUS_COLOR } from '@/lib/labels'
import { CardLabel, CardShell, Dot } from './shared'

const STATUS_LABEL = { ok: 'On track', gap: 'Needs attention', at_risk: 'At risk' } as const

export function AuditCard({ card, citations }: { card: AuditCardT; citations: Citation[] }) {
  return (
    <CardShell className="gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>Degree audit</CardLabel>
        <span className="flex items-center gap-1.5 text-xs text-ink-5">
          <Dot color={card.onTrack ? STATUS_COLOR.ok : STATUS_COLOR.gap} className="size-1.5" />
          {card.onTrack ? 'On track' : 'Off track'} · {fmtTime(card.computedAt)}
        </span>
      </div>
      <div className="text-[15px] leading-[21px] font-bold text-pretty">{card.headline}</div>
      {card.buckets.map((b) => {
        const color = STATUS_COLOR[b.status]
        const pct = b.required > 0 ? Math.min(100, Math.round((b.done / b.required) * 100)) : 100
        return (
          <div key={b.name} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-1.5">
                <Dot color={color} />
                {b.name}
              </span>
              <span className="text-ink-5">
                <b className="text-ink">
                  {b.done}/{b.required}
                </b>{' '}
                · {STATUS_LABEL[b.status]}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-line">
              <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: color }} />
            </div>
            {b.note && (
              <div className="flex items-start gap-2 rounded-md border border-line bg-white px-2.5 py-2 text-[13px] leading-[19px]">
                <Icon name="info" size={16} style={{ color, lineHeight: '19px' }} />
                <span className="flex-1">{b.note}</span>
                <CitePills ids={b.citationIds} citations={citations} />
              </div>
            )}
          </div>
        )
      })}
      {card.unmetPrereqs.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <span className="flex items-center gap-1.5 text-xs font-bold">
            <Dot color={STATUS_COLOR.at_risk} />
            Unmet prerequisites
          </span>
          {card.unmetPrereqs.map((p) => (
            <div key={p.course} className="pl-3.5 text-[13px] leading-[19px]">
              <b>{p.course}</b> <span className="text-ink-5">needs {p.missing}</span>
              <CitePills ids={[p.citationId]} citations={citations} />
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
