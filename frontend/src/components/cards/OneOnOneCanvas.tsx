import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { askCoach } from '@/lib/actions'
import { fmtMinutes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { OneOnOne } from '@/types'
import { CardLabel } from './shared'
import { StudyPlanCard } from './StudyPlanCard'

const STATUS = { ready: 'Ready', in_progress: 'In progress', done: 'Done' } as const
const CHANGE: Record<OneOnOne['proposedAdjustments'][number]['change'], { label: string; icon: string }> = {
  add: { label: 'Add', icon: 'add' },
  move: { label: 'Move', icon: 'east' },
  drop: { label: 'Drop', icon: 'remove' },
  resize: { label: 'Resize', icon: 'height' },
}

function Tile({ label, value, sub, pct }: { label: string; value: string; sub?: string; pct?: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-white px-3.5 py-3">
      <span className="text-[10px] font-bold tracking-[.06em] text-ink-5 uppercase">{label}</span>
      <b className="text-[22px] leading-7 font-black">{value}</b>
      {pct != null && (
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-line">
          <div className="h-full rounded-[3px] bg-cyan" style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} />
        </div>
      )}
      {sub && <span className="text-xs text-ink-5">{sub}</span>}
    </div>
  )
}

function Question({ q, locked }: { q: OneOnOne['questions'][number]; locked: boolean }) {
  const [draft, setDraft] = useState(q.answer ?? '')
  const [state, setState] = useState<{ busy: boolean; error?: string; saved: boolean }>({ busy: false, saved: !!q.answer })
  const answerQuestion = useWS((s) => s.answerQuestion)
  const dirty = draft.trim() !== (q.answer ?? '').trim()
  const save = async () => {
    if (!draft.trim() || state.busy) return
    setState({ busy: true, saved: false })
    try {
      await answerQuestion(q.id, draft.trim())
      setState({ busy: false, saved: true })
    } catch (e) {
      setState({ busy: false, saved: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-bold" htmlFor={`q-${q.id}`}>
        {q.prompt}
      </label>
      <div className="flex items-start gap-2">
        <textarea
          id={`q-${q.id}`}
          value={draft}
          disabled={locked}
          onChange={(e) => (setDraft(e.target.value), setState((s) => ({ ...s, saved: false })))}
          rows={2}
          placeholder="A line is enough"
          className="min-h-[44px] flex-1 resize-y rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] leading-[19px] outline-none focus:border-ink-5 disabled:bg-soft"
        />
        {!locked && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!draft.trim() || state.busy || (!dirty && state.saved)}
            className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-ink px-3 text-xs font-bold text-ink hover:bg-soft disabled:cursor-default disabled:border-line disabled:text-ink-4"
          >
            {state.busy ? <Spinner size={12} /> : state.saved && !dirty ? <Icon name="check" size={14} /> : null}
            {state.busy ? 'Saving' : state.saved && !dirty ? 'Saved' : 'Save'}
          </button>
        )}
      </div>
      {state.error && <span className="text-xs text-bad">Couldn’t save: {state.error}</span>}
    </div>
  )
}

/** Weekly 1:1 (contracts §7): recap computed from the calendar, grounded lines, questions, adjustments. */
export function OneOnOneCanvas() {
  const entry = useWS((s) => s.oneOnOne)
  const busy = useWS((s) => s.oneOnOneBusy)
  const notice = useWS((s) => s.oneOnOneNotice)
  const load = useWS((s) => s.loadOneOnOne)
  const complete = useWS((s) => s.completeOneOnOne)
  const [share, setShare] = useState(false)
  const one = entry?.value
  // Statuses may have changed since the last load; the recap is recomputed server-side.
  useEffect(() => void load(true), [load])
  useEffect(() => setShare(one?.shareWithAdvisor ?? false), [one?.id, one?.shareWithAdvisor])

  if (!one)
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-ink-5">
        {entry?.status === 'error' ? (
          <>
            <Icon name="error" size={16} className="text-bad" />
            Couldn’t build your weekly review: {entry.error} —
            <button type="button" onClick={() => void load()} className="cursor-pointer font-bold text-link">
              try again
            </button>
          </>
        ) : (
          <>
            <Spinner size={13} /> Building your weekly review from last week’s calendar…
          </>
        )}
      </div>
    )

  const r = one.recap
  if (!r.blocksPlanned)
    return (
      <div className="flex max-w-[640px] flex-col items-start gap-2.5 py-4">
        <CardLabel>Weekly 1:1 · {one.weekLabel}</CardLabel>
        <b className="text-lg">Nothing to review yet</b>
        <span className="text-[13px] leading-5 text-ink-5">No study blocks were scheduled in the last 7 days. Build a plan first; next week’s review will look back at it.</span>
        <button type="button" onClick={() => askCoach('What should I study this week?')} className="h-8 cursor-pointer rounded-md bg-ink px-3.5 text-[13px] font-bold text-white">
          What should I study this week?
        </button>
      </div>
    )

  const done = one.status === 'done'
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-ink text-cyan">
          <Icon name="event_repeat" size={20} />
        </span>
        <div className="flex flex-col">
          <b className="text-lg leading-6 font-black">Weekly 1:1 · {one.weekLabel}</b>
          <span className="text-xs text-ink-5">Recap computed from your calendar; lines grounded in it.</span>
        </div>
        <span className={cn('ml-auto rounded-full border px-2.5 py-0.5 text-xs font-bold', done ? 'border-ok bg-ok-soft' : one.status === 'in_progress' ? 'border-warn bg-warn-soft' : 'border-cyan bg-cyan-soft')}>
          {STATUS[one.status]}
        </span>
        {entry?.status === 'loading' && <Spinner size={13} className="text-ink-5" />}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile label="Minutes" value={`${r.doneMinutes}/${r.plannedMinutes}`} pct={r.plannedMinutes ? r.doneMinutes / r.plannedMinutes : 0} sub={`${fmtMinutes(r.doneMinutes)} done`} />
        <Tile label="Blocks" value={`${r.blocksDone}/${r.blocksPlanned}`} pct={r.blocksPlanned ? r.blocksDone / r.blocksPlanned : 0} sub={`${r.blocksPlanned - r.blocksDone} not done`} />
        <Tile label="Streak" value={`${r.streakDays} day${r.streakDays === 1 ? '' : 's'}`} sub="days with a done block" />
        <Tile label="Flagged in class" value={String(r.flaggedTopics.reduce((n, f) => n + f.times, 0))} sub={r.flaggedTopics.length ? r.flaggedTopics.map((f) => f.topic).join(', ') : 'no “I’m stuck” taps'} />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {r.completedTopics.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-ink-5">Completed</span>
            {r.completedTopics.map((t) => (
              <span key={t} className="rounded-full border border-ok bg-white px-2 py-px text-xs">
                {t}
              </span>
            ))}
          </span>
        )}
        {r.skippedTopics.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-ink-5">Skipped</span>
            {r.skippedTopics.map((t) => (
              <span key={t} className="rounded-full border border-warn bg-warn-soft px-2 py-px text-xs">
                {t}
              </span>
            ))}
          </span>
        )}
        {r.flaggedTopics.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-ink-5">Flagged</span>
            {r.flaggedTopics.map((f) => (
              <span key={f.topic} className="rounded-full border border-bad bg-bad-soft px-2 py-px text-xs">
                🚩 {f.topic} ×{f.times}
              </span>
            ))}
          </span>
        )}
        {r.weakTopicMovement.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-ink-5">Impact</span>
            {r.weakTopicMovement.map((m) => (
              <span key={m.topic} className="rounded-full border border-line bg-white px-2 py-px text-xs">
                {m.topic} {m.from} → {m.to}
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-soft px-4 py-3">
          <CardLabel>Wins</CardLabel>
          {one.wins.length ? (
            one.wins.map((w) => (
              <span key={w} className="flex items-start gap-1.5 text-[13px] leading-[19px]">
                <Icon name="check_circle" size={15} fill className="mt-0.5 text-ok" />
                {w}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-ink-5">—</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-soft px-4 py-3">
          <CardLabel>Concerns</CardLabel>
          {one.concerns.length ? (
            one.concerns.map((c) => (
              <span key={c} className="flex items-start gap-1.5 text-[13px] leading-[19px]">
                <Icon name="error" size={15} fill className="mt-0.5 text-warn" />
                {c}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-ink-5">Nothing flagged.</span>
          )}
        </div>
      </div>

      {one.questions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3.5">
          <CardLabel>Questions for you</CardLabel>
          {one.questions.map((q) => (
            <Question key={q.id} q={q} locked={done} />
          ))}
        </div>
      )}

      {one.proposedAdjustments.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line px-4 py-3.5">
          <CardLabel>Proposed adjustments</CardLabel>
          {one.proposedAdjustments.map((a, i) => (
            <span key={i} className="flex items-start gap-2 text-[13px] leading-[19px]">
              <span className="mt-px flex flex-none items-center gap-0.5 rounded border border-line bg-soft px-1.5 text-[10px] font-bold text-ink-5 uppercase">
                <Icon name={CHANGE[a.change].icon} size={12} />
                {CHANGE[a.change].label}
              </span>
              {a.detail}
            </span>
          ))}
        </div>
      )}

      {!done ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <button
              type="button"
              role="switch"
              aria-checked={share}
              onClick={() => setShare(!share)}
              className={cn('relative h-5 w-9 flex-none cursor-pointer rounded-full transition-colors', share ? 'bg-ink' : 'bg-ink-3')}
            >
              <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', share ? 'left-[18px] bg-cyan' : 'left-0.5')} />
            </button>
            Share with advisor
            <span className="text-xs text-ink-5">(opens a ticket with this summary)</span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void complete(share)}
            className="ml-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-bold text-white hover:bg-ink-7 disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? <Spinner size={13} /> : <Icon name="task_alt" size={17} />}
            {busy ? 'Re-planning your week…' : 'Complete review'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-line pt-3.5">
          {notice && (
            <div className="flex items-center gap-2 text-[13px] text-ink-5">
              <Icon name="event_available" size={16} className="text-ok" />
              <b className="text-ink">{notice}</b>
              <span>— the adjusted plan is on your calendar{one.shareWithAdvisor ? ' and your advisor has the summary' : ''}.</span>
            </div>
          )}
          {!notice && one.shareWithAdvisor && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-5">
              <Icon name="support_agent" size={16} /> Shared with your advisor.
            </span>
          )}
          {one.adjustedPlan && <StudyPlanCard card={one.adjustedPlan} citations={[]} title="Adjusted plan" />}
        </div>
      )}
      {notice && !done && <span className="text-[13px] text-bad">{notice}</span>}
    </div>
  )
}
