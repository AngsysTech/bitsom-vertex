import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { useCalendarItem } from '@/hooks/useCalendar'
import { ACTION_KIND_LABEL, COMMITMENT_LABEL } from '@/lib/labels'
import { fmtDayShort, fmtDow, fmtHM, mmss, parseISO } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { ActionItem, ActionsCard as ActionsCardT, Citation } from '@/types'
import { CardLabel, CardShell } from './shared'

const ORDER: ActionItem['kind'][] = ['prep', 'deadline', 'study', 'review', 'resource', 'ask']

const due = (iso?: string) => {
  if (!iso) return null
  const d = parseISO(iso)
  return iso.length > 10 ? `${fmtDayShort(d)} ${fmtHM(d)}` : fmtDayShort(d)
}

/** "Added to plan · Tue 18:30" — the slot comes from the calendar item the accept created. */
function Added({ action }: { action: ActionItem }) {
  const item = useCalendarItem(action.calendarItemId)
  const when = item ? (item.allDay ? `${fmtDow(item.start)} (all day)` : `${fmtDow(item.start)} ${fmtHM(item.start)}`) : null
  return (
    <span className="flex items-center gap-1 text-xs font-bold text-ink">
      <Icon name="event_available" size={15} className="text-ok" />
      {action.calendarItemId ? (when ? `Added to plan · ${when}` : 'Added to plan') : 'Accepted'}
    </span>
  )
}

function ActionRow({ a, flagAt }: { a: ActionItem; flagAt?: number }) {
  const busy = useWS((s) => !!s.actionBusy[a.id])
  const error = useWS((s) => s.actionError[a.id])
  const setActionStatus = useWS((s) => s.setActionStatus)
  const dismissed = a.status === 'dismissed'
  return (
    <div className={cn('flex flex-col gap-1 border-t border-line py-2 text-[13px] leading-[18px]', dismissed && 'opacity-55')}>
      <div className="flex items-start justify-between gap-2">
        <b className={cn('min-w-0', dismissed && 'line-through')}>{a.title}</b>
        {a.kind === 'review' && flagAt != null && (
          <span className="flex flex-none items-center gap-0.5 rounded-full border border-bad bg-bad-soft px-1.5 font-mono text-[10px] font-bold" data-tip="You flagged this in class">
            🚩 {mmss(flagAt)}
          </span>
        )}
      </div>
      <span className="text-xs text-ink-5">
        {[a.minutes && `${a.minutes} min`, a.dueBy && `due ${due(a.dueBy)}`].filter(Boolean).join(' · ')}
      </span>
      <span className="text-xs leading-[17px] text-ink">{a.why}</span>
      <div className="mt-0.5 flex items-center gap-1.5">
        {a.status === 'proposed' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void setActionStatus(a, 'accepted')}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-md bg-ink px-2.5 text-xs font-bold text-white hover:bg-ink-7 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? <Spinner size={12} /> : <Icon name="add_task" size={15} />}
              {busy ? 'Adding…' : 'Accept'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void setActionStatus(a, 'dismissed')}
              className="h-7 cursor-pointer rounded-md border border-line px-2.5 text-xs font-bold text-ink hover:bg-soft disabled:cursor-wait"
            >
              Dismiss
            </button>
          </>
        )}
        {a.status === 'accepted' && <Added action={a} />}
        {a.status === 'done' && (
          <span className="flex items-center gap-1 text-xs font-bold text-ok">
            <Icon name="check_circle" size={15} fill /> Done
          </span>
        )}
        {dismissed && (
          <button type="button" disabled={busy} onClick={() => void setActionStatus(a, 'proposed')} className="cursor-pointer text-xs font-bold text-link">
            Dismissed · undo
          </button>
        )}
        {error && <span className="truncate text-xs text-bad" title={error}>Couldn’t update: {error}</span>}
      </div>
    </div>
  )
}

/** Lecture commitments first, then actions grouped by kind with Accept / Dismiss. */
export function ActionsCard({ card, flags = {} }: { card: ActionsCardT; citations: Citation[]; flags?: Record<string, number> }) {
  const proposed = card.items.filter((a) => a.status === 'proposed').length
  const groups = ORDER.map((k) => [k, card.items.filter((a) => a.kind === k)] as const).filter(([, list]) => list.length)
  return (
    <CardShell className="gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>Actions</CardLabel>
        <span className="text-xs text-ink-5">{proposed ? `${proposed} to review` : 'all reviewed'}</span>
      </div>
      {card.commitments.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-white px-2.5 py-2">
          <span className="text-[10px] font-bold tracking-[.06em] text-ink-5 uppercase">The lecturer said</span>
          {card.commitments.map((c) => (
            <div key={c.id} className="flex items-start gap-1.5 text-xs leading-[17px]" data-tip={`“${c.quote}”`}>
              <span className="mt-px flex-none rounded border border-line bg-soft px-1 text-[10px] font-bold text-ink-5">{COMMITMENT_LABEL[c.kind] ?? c.kind}</span>
              <span className="min-w-0 flex-1">{c.text}</span>
              {c.dueBy && <span className="flex-none text-ink-5">{due(c.dueBy)}</span>}
            </div>
          ))}
        </div>
      )}
      {!card.items.length && <span className="text-[13px] text-ink-5">Nothing in this lecture needs a follow-up action.</span>}
      {groups.map(([kind, list]) => (
        <div key={kind} className="flex flex-col">
          <span className="pt-1 text-[10px] font-bold tracking-[.06em] text-ink-5 uppercase">
            {ACTION_KIND_LABEL[kind]} · {list.length}
          </span>
          {list.map((a) => (
            <ActionRow key={a.id} a={a} flagAt={a.provenance.markerId ? flags[a.provenance.markerId] : undefined} />
          ))}
        </div>
      ))}
    </CardShell>
  )
}
