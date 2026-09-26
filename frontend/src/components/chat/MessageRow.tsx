import { Icon } from '@/components/Icon'
import { Markdown } from '@/components/Markdown'
import { ADVISOR_NAME } from '@/lib/config'
import { fmtTime, initials } from '@/lib/format'
import { isClubAgent } from '@/lib/labels'
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
  return (
    <>
      <button
        type="button"
        onClick={() => set((s) => ({ traceOpen: { ...s.traceOpen, [m.id]: !expanded } }))}
        className="-ml-1.5 mt-[3px] mb-1 flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-[13px] text-ink-5 hover:border-line hover:bg-white"
      >
        <Icon name="bolt" size={16} className="text-link" />
        <b className="text-link">Worked for {(total / 1000).toFixed(1)}s</b>
        <span className="truncate">· {m.trace.map((t) => t.tool).join(', ')}</span>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} />
      </button>
      {expanded && (
        <div className="mb-2 ml-0.5 flex flex-col gap-1 border-l-2 border-line py-0.5 pl-3">
          {m.trace.map((t, i) => (
            <div key={i} className="text-[13px] leading-[19px]">
              <b className="font-mono text-xs">{t.tool}</b> <span className="text-ink-5">— {t.summary}</span>{' '}
              {t.durationMs > 0 && <span className="text-xs text-ink-4">{(t.durationMs / 1000).toFixed(1)}s</span>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** One chat line. `dmAgent` is the agent whose DM this is (fallback when a message has no agentId). */
export function MessageRow({ m, dmAgent }: { m: Message; dmAgent: Agent }) {
  const agents = useWS((s) => s.agents)
  const studentName = useWS((s) => s.students.find((x) => x.id === s.studentId)?.name ?? 'You')
  const openCitation = useWS((s) => s.openCitation)

  if (m.role === 'system')
    return (
      <div className="flex items-start gap-2 py-2 pr-5 pl-[66px] text-[13px] text-ink-5">
        <Icon name="info" size={16} className="mt-0.5 text-ink-4" />
        <Markdown text={m.text} citations={m.citations} />
      </div>
    )

  const agent = m.role === 'agent' ? (agents.find((a) => a.id === m.agentId) ?? dmAgent) : undefined
  const club = !!agent && isClubAgent(agent.id)
  const reply = !!m.replyToId
  const name = m.role === 'student' ? studentName : m.role === 'advisor' ? ADVISOR_NAME : (agent?.name ?? 'Agent')
  const badge = m.role === 'advisor' ? 'ADVISOR' : m.role === 'agent' ? (club ? 'CLUB' : 'AGENT') : null
  const esc = m.escalation

  return (
    <>
      <div
        className={cn('flex gap-2.5 py-2 pr-5 hover:bg-soft', reply ? 'pl-[66px]' : 'pl-5')}
        style={m.role === 'agent' && !reply ? { boxShadow: 'inset 3px 0 0 #E2E8F0' } : undefined}
      >
        <Avatar m={m} agent={agent} small={reply} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <b className="text-[15px]">{name}</b>
            {badge && <span className="rounded-[3px] bg-mist px-1 py-px text-[10px] font-bold tracking-[.04em] text-ink-5">{badge}</span>}
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
            <span
              className={cn(
                'rounded-full border px-2 py-px text-[11px] font-bold text-ink',
                esc.status === 'open' ? 'border-warn bg-warn-soft' : 'border-ok bg-ok-soft',
              )}
            >
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
