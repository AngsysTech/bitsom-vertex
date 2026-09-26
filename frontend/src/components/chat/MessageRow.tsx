import { Icon } from '@/components/Icon'
import { Markdown } from '@/components/Markdown'
import { ADVISOR_NAME, DEFAULT_AGENT } from '@/lib/config'
import { fmtTime, initials } from '@/lib/format'
import { isClubAgent } from '@/lib/labels'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Agent, Message } from '@/types'

function Avatar({ m, agent, small }: { m: Message; agent?: Agent; small: boolean }) {
  const size = small ? 'size-7' : 'size-9'
  const studentName = useWS((s) => s.students.find((x) => x.id === s.studentId)?.name ?? '')
  if (m.role === 'student')
    return <span className={cn(size, 'flex flex-none items-center justify-center rounded-lg bg-ink text-[13px] font-black text-white')}>{initials(studentName)}</span>
  if (m.role === 'advisor')
    return (
      <span className={cn(size, 'flex flex-none items-center justify-center rounded-lg bg-ink-5 text-white')}>
        <Icon name="person" size={20} />
      </span>
    )
  return (
    <span className={cn(size, 'flex flex-none items-center justify-center rounded-lg border border-line bg-soft', small ? 'text-[15px]' : 'text-[19px]')}>
      {agent?.emoji ?? '🤖'}
    </span>
  )
}

function Trace({ m }: { m: Message }) {
  const expanded = useWS((s) => !!s.traceOpen[m.id])
  const set = useWS((s) => s.set)
  const total = m.trace.reduce((n, t) => n + (t.durationMs || 0), 0)
  const failed = m.trace.some((t) => t.error)
  // "class_companion · 5 steps" rather than five dotted names; the list opens on click.
  const tools = [...new Set(m.trace.map((t) => t.tool.split('.')[0]!))]
  return (
    <>
      <button
        type="button"
        onClick={() => set((s) => ({ traceOpen: { ...s.traceOpen, [m.id]: !expanded } }))}
        className="-ml-1.5 mt-px mb-0.5 flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-5 hover:bg-mist"
      >
        <Icon name={failed ? 'error' : 'bolt'} size={15} fill className={failed ? 'text-bad' : 'text-link'} />
        <b className={cn('flex-none whitespace-nowrap', failed ? 'text-bad' : 'text-link')}>Worked for {(total / 1000).toFixed(1)}s</b>
        <span className="min-w-0 truncate">
          · {tools.join(', ')}
          {m.trace.length > tools.length && ` · ${m.trace.length} steps`}
        </span>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} className="text-ink-4" />
      </button>
      {expanded && (
        <div className="mb-2 ml-0.5 flex flex-col gap-1 border-l-2 border-line py-0.5 pl-3">
          {m.trace.map((t, i) => (
            <div key={i} className="text-[13px] leading-[19px]">
              <b className="font-mono text-xs">{t.tool}</b> <span className="text-ink-5">— {t.summary}</span>{' '}
              {t.durationMs > 0 && <span className="text-xs text-ink-4">{(t.durationMs / 1000).toFixed(1)}s</span>}
              {t.error && <div className="text-xs text-bad">error: {t.error}</div>}
              {!!t.dropped?.length && <div className="text-xs text-warn-ink">dropped (failed verification): {t.dropped.join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Small chips for the cards a message carried (the cards themselves render in the panel / canvas). */
function CardChips({ m }: { m: Message }) {
  const set = useWS((s) => s.set)
  const chips = m.cards.flatMap((c) => {
    if (c.type === 'coverage') return [{ key: 'coverage', icon: 'fact_check', label: `Coverage · ${c.covered.length} covered${c.confusion?.length ? ` · ${c.confusion.length} flagged` : ''}`, go: () => set({ panelOpen: true, panelMode: 'context' }) }]
    if (c.type === 'actions') return [{ key: 'actions', icon: 'checklist', label: `${c.items.length} actions`, go: () => set({ panelOpen: true, panelMode: 'context' }) }]
    if (c.type === 'one_on_one')
      return [
        {
          key: 'one_on_one',
          icon: 'event_repeat',
          label: `Open Weekly 1:1 · ${c.oneOnOne.weekLabel}`,
          go: () => {
            set({ tab: 'canvas', canvas: 'one_on_one', oneOnOne: { status: 'ready', value: c.oneOnOne } })
            navigate(`/dm/${DEFAULT_AGENT}`)
          },
        },
      ]
    if (c.type === 'study_plan') return [{ key: 'plan', icon: 'calendar_month', label: 'See it on the calendar', go: () => (set({ tab: 'canvas', canvas: 'calendar' }), navigate(`/dm/${DEFAULT_AGENT}`)) }]
    return []
  })
  if (!chips.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.go} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-bold text-ink shadow-[0_1px_1px_rgba(15,23,42,.04)] hover:border-ink-3 hover:bg-soft">
          <Icon name={c.icon} size={16} className="text-ink-5" />
          {c.label}
        </button>
      ))}
    </div>
  )
}

/** Lecture events in a class channel ("Lecture recorded · 22 Sep · 48 min", "Handout ready") render as markers. */
function systemIcon(text: string) {
  if (/^(Lecture recorded|Audio uploaded|Transcript added)/.test(text)) return 'mic'
  if (/^Handout ready/.test(text)) return 'description'
  if (/stopped at|failed|couldn/i.test(text)) return 'error'
  return 'info'
}

/** Replies that send the student to the DM ("ask me in my DM") get an Open DM chip. */
const pointsToDm = (text: string) => /\b(my|the) DM\b|direct message/i.test(text)

/** One chat line. `dmAgent` is the agent whose thread this is (fallback when a message has no agentId). */
export function MessageRow({ m, dmAgent, inClass, highlight }: { m: Message; dmAgent: Agent; inClass?: string; highlight?: boolean }) {
  const agents = useWS((s) => s.agents)
  const studentName = useWS((s) => s.students.find((x) => x.id === s.studentId)?.name ?? 'You')
  const openCitation = useWS((s) => s.openCitation)

  if (m.role === 'system') {
    const icon = systemIcon(m.text)
    return (
      <div data-msg-id={m.id} className={cn('flex items-start gap-2 py-1.5 pr-5 pl-[66px] text-[13px] text-ink-5', highlight && 'animate-flash')}>
        <Icon name={icon} size={16} className={cn('mt-0.5', icon === 'error' ? 'text-bad' : 'text-ink-4')} />
        <div className="min-w-0 flex-1">
          <Markdown text={m.text} citations={m.citations} />
          {(() => {
            const err = m.trace.find((t) => t.error)?.error
            return err && !m.text.includes(err) ? <span className="text-xs text-bad">{err}</span> : null
          })()}
        </div>
        <span className="flex-none text-[11px] text-ink-4">{fmtTime(m.createdAt)}</span>
      </div>
    )
  }

  const agent = m.role === 'agent' ? (agents.find((a) => a.id === m.agentId) ?? dmAgent) : undefined
  const club = !!agent && isClubAgent(agent.id)
  const reply = !!m.replyToId
  const name = m.role === 'student' ? studentName : m.role === 'advisor' ? ADVISOR_NAME : (agent?.name ?? 'Agent')
  const badge = m.role === 'advisor' ? 'ADVISOR' : m.role === 'agent' ? (club ? 'CLUB' : 'AGENT') : null
  const esc = m.escalation

  return (
    <>
      <div
        data-msg-id={m.id}
        className={cn('flex gap-2.5 py-2 pr-5 hover:bg-soft', reply ? 'pl-[66px]' : 'pl-5', highlight && 'animate-flash')}
      >
        <Avatar m={m} agent={agent} small={reply} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <b className="text-[15px]">{name}</b>
            {badge && <span className="rounded-[3px] bg-mist px-1 py-px text-[10px] font-bold tracking-[.04em] text-ink-5">{badge}</span>}
            {inClass && m.role === 'agent' && <span className="rounded-[3px] border border-line px-1 py-px text-[10px] font-bold text-ink-5">in {inClass}</span>}
            <span className="text-xs text-ink-5">{fmtTime(m.createdAt)}</span>
          </div>
          {reply && (
            <div className="mt-px mb-0.5 flex items-center gap-1 text-xs text-ink-5">
              <Icon name="subdirectory_arrow_right" size={14} />
              replied in thread
            </div>
          )}
          {m.trace.length > 0 && <Trace m={m} />}
          <Markdown text={m.text} citations={m.citations} className="text-[15px] leading-[22px] text-pretty text-ink" />
          {inClass && m.role === 'agent' && pointsToDm(m.text) && (
            <button
              type="button"
              onClick={() => navigate(`/dm/${DEFAULT_AGENT}`)}
              className="mt-1.5 flex h-6 cursor-pointer items-center gap-1 rounded-full border border-ink bg-white px-2.5 text-xs font-bold text-ink hover:bg-soft"
            >
              <Icon name="chat_bubble" size={13} />
              Open DM
            </button>
          )}
          <CardChips m={m} />
          {m.citations.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-5">
              <span className="flex items-center gap-1 font-bold">
                <Icon name="link" size={14} />
                {m.citations.length} source{m.citations.length > 1 ? 's' : ''}
              </span>
              {m.citations.map((c) => (
                <button key={c.id} type="button" onClick={() => openCitation(c)} className="cursor-pointer text-left text-xs text-ink-5 hover:text-ink hover:underline">
                  <b className="text-ink">{c.id}</b> {c.docTitle} › {c.sectionHeading}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {esc && (
        <div className="flex items-center gap-2 pt-1.5 pr-5 pb-2.5 pl-[66px] text-[13px] text-ink-5">
          <div className="flex flex-none items-center gap-2 rounded-md border border-line bg-soft px-2.5 py-[5px]">
            <Icon name="support_agent" size={16} />
            <span>
              Escalated to <b className="text-ink">Human Advisor</b> · Ticket #{esc.ticketId} ·
            </span>
            <span className={cn('rounded-full border px-2 py-px text-[11px] font-bold text-ink', esc.status === 'open' ? 'border-warn bg-warn-soft' : 'border-ok bg-ok-soft')}>
              {esc.status === 'open' ? 'Open' : 'Answered'}
            </span>
          </div>
        </div>
      )}
    </>
  )
}

export function ErrorMarker({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 py-2 pr-5 pl-[66px] text-[13px] text-ink-5">
      <Icon name="error" size={16} className="text-bad" />
      <span>Something went wrong —</span>
      <button type="button" onClick={onRetry} className="cursor-pointer p-0 text-[13px] font-bold text-link">
        try again
      </button>
      <span className="truncate text-xs text-ink-4" title={error}>
        ({error})
      </span>
    </div>
  )
}
