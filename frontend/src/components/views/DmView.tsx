import { Fragment, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { ContextCards } from '@/components/cards/ContextCards'
import { Composer } from '@/components/chat/Composer'
import { ErrorMarker, MessageRow } from '@/components/chat/MessageRow'
import { Icon } from '@/components/Icon'
import { useScopeChips } from '@/hooks/useScopeChips'
import { latestCards, orderedCards } from '@/lib/cards'
import { dayKey, dayLabel } from '@/lib/format'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS, type ThreadView } from '@/store/workspace'
import type { Agent, Message } from '@/types'

function Header({ agent }: { agent: Agent }) {
  const starred = useWS((s) => s.starred.includes(agent.id))
  const panelOpen = useWS((s) => s.panelOpen)
  const tab = useWS((s) => s.tab)
  const set = useWS((s) => s.set)
  const chips = useScopeChips(agent)
  const tabCls = (on: boolean) =>
    cn('flex cursor-pointer items-center gap-1 border-b-2 px-0.5 py-2 text-[13px] font-bold', on ? 'border-ink text-ink' : 'border-transparent text-ink-5')

  return (
    <div className="flex-none border-b border-line px-5 pt-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-line bg-soft text-lg">{agent.emoji}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-black">{agent.name}</span>
            <button
              type="button"
              onClick={() => set((s) => ({ starred: starred ? s.starred.filter((x) => x !== agent.id) : [...s.starred, agent.id] }))}
              data-tip={starred ? 'Remove from Starred' : 'Star conversation'}
              className="flex cursor-pointer p-0.5 text-ink-5"
            >
              <Icon name="star" size={18} fill={starred} />
            </button>
          </div>
          <span className="text-[13px] text-ink-5">{agent.tagline}</span>
        </div>
        {!panelOpen && (
          <button
            type="button"
            onClick={() => set({ panelOpen: true })}
            data-tip="Show context"
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-bold text-ink"
          >
            <Icon name="view_sidebar" size={18} />
            Context
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-5">Reads:</span>
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => navigate(`/files/${c.docIds[0]}`)}
            data-tip={c.docIds.length > 1 ? `${c.docIds.length} documents` : undefined}
            className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-full border border-line bg-soft px-2 text-xs text-ink hover:border-ink-5"
          >
            <Icon name="description" size={14} className="text-ink-5" />
            {c.label}
            {c.docIds.length > 1 && <span className="text-ink-4">{c.docIds.length}</span>}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-5">
        <button type="button" onClick={() => set({ tab: 'messages' })} className={tabCls(tab === 'messages')}>
          Messages
        </button>
        <button type="button" onClick={() => set({ tab: 'canvas' })} className={tabCls(tab === 'canvas')}>
          <Icon name="dashboard" size={16} />
          Canvas
        </button>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <>
      {[
        ['82%', '64%'],
        ['70%', '48%'],
        ['90%', '58%'],
      ].map(([w1, w2]) => (
        <div key={w1} className="flex gap-2.5 px-5 py-2.5">
          <div className="size-9 flex-none rounded-lg bg-line" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <div className="h-3 w-40 rounded bg-line" />
            <div className="h-2.5 rounded bg-mist" style={{ width: w1 }} />
            <div className="h-2.5 rounded bg-mist" style={{ width: w2 }} />
          </div>
        </div>
      ))}
    </>
  )
}

function EmptyState({ agent }: { agent: Agent }) {
  const send = useWS((s) => s.send)
  return (
    <div className="flex max-w-[720px] flex-col gap-2.5 px-5 pt-7 pb-4">
      <span className="flex size-[72px] items-center justify-center rounded-[14px] border border-line bg-soft text-[38px]">{agent.emoji}</span>
      <span className="mt-1 text-[22px] font-black">{agent.name}</span>
      <span className="text-[15px] leading-[22px]">
        This conversation is just between <b className="text-link">@{agent.name}</b> and you.
      </span>
      <span className="text-[15px] leading-[22px] text-ink-5">{agent.tagline}.</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {agent.starters.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void send(agent.id, q)}
            className="h-8 cursor-pointer rounded-full border border-line bg-white px-3.5 text-[13px] font-bold text-ink hover:border-ink-5 hover:bg-soft"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-1 pb-2">
      <div className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line px-3 py-[3px] text-xs font-bold">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

function Thinking({ agent }: { agent: Agent }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-2">
      <span className="flex size-9 flex-none items-center justify-center rounded-lg border border-line bg-soft text-[19px] opacity-70">{agent.emoji}</span>
      <span className="flex items-center gap-2 text-[13px] text-ink-5">
        <span className="inline-flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-[5px] animate-dot rounded-full bg-ink-5" style={{ animationDelay: `${i * 0.16}s` }} />
          ))}
        </span>
        <span>
          <b className="text-ink">{agent.name}</b> is thinking…
        </span>
      </span>
    </div>
  )
}

/** Server messages + local-only rows (failed sends), with a day divider before each new day. */
function renderThread(th: ThreadView, agent: Agent, retry: (id: string) => void) {
  const out: ReactNode[] = []
  const known = new Set(th.messages.map((m) => m.id))
  const failedAt = (after: string | null) =>
    th.failed
      .filter((f) => f.afterId === after || (after === '$end' && f.afterId !== null && !known.has(f.afterId)))
      .forEach((f) => {
        const pseudo: Message = { id: f.id, threadId: '', role: 'student', createdAt: new Date().toISOString(), text: f.text, citations: [], cards: [], trace: [] }
        out.push(
          <Fragment key={f.id}>
            <MessageRow m={pseudo} dmAgent={agent} />
            <ErrorMarker error={f.error} onRetry={() => retry(f.id)} />
          </Fragment>,
        )
      })
  let day = ''
  failedAt(null)
  for (const m of th.messages) {
    if (dayKey(m.createdAt) !== day) {
      day = dayKey(m.createdAt)
      out.push(<Divider key={`d:${day}`} label={dayLabel(m.createdAt)} />)
    }
    out.push(<MessageRow key={m.id} m={m} dmAgent={agent} />)
    failedAt(m.id)
  }
  failedAt('$end')
  return out
}

function Messages({ agent }: { agent: Agent }) {
  const th = useWS((s) => s.threads[agent.id])
  const loading = useWS((s) => s.loadingStudent) || !th || th.status === 'loading'
  const studentId = useWS((s) => s.studentId)
  const retry = useWS((s) => s.retry)
  const loadThread = useWS((s) => s.loadThread)
  const ref = useRef<HTMLDivElement>(null)

  const count = th ? th.messages.length + th.failed.length : 0
  const sending = !!th?.sending
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [studentId, agent.id, count, sending, loading])

  const empty = !!th && th.status === 'ready' && !th.messages.length && !th.failed.length && !th.sending
  return (
    <div ref={ref} className="flex-1 overflow-y-auto pt-3 pb-2">
      {loading || !th ? (
        <Skeleton />
      ) : th.status === 'error' ? (
        <ErrorMarker error={th.error ?? 'Could not load this thread'} onRetry={() => void loadThread(agent.id)} />
      ) : (
        <>
          {empty && <EmptyState agent={agent} />}
          {renderThread(th, agent, (id) => retry(agent.id, id))}
          {th.sending && (
            <>
              {!th.messages.length && <Divider label="Today" />}
              <MessageRow m={th.sending} dmAgent={agent} />
              <Thinking agent={agent} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function CanvasTab({ agent }: { agent: Agent }) {
  const msgs = useWS((s) => s.threads[agent.id]?.messages)
  const cards = useMemo(() => orderedCards(latestCards(msgs)), [msgs])
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <ContextCards cards={cards} cols="repeat(auto-fill,minmax(340px,1fr))" />
    </div>
  )
}

export function DmView({ agentId }: { agentId: string }) {
  const agent = useWS((s) => s.agents.find((a) => a.id === agentId))
  const tab = useWS((s) => s.tab)
  const loading = useWS((s) => s.loadingStudent)
  const studentError = useWS((s) => s.studentError)
  const hasAgents = useWS((s) => s.agents.length > 0)

  if (!agent) {
    if (studentError) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-bad">Couldn’t load the workspace: {studentError}</div>
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-5">
        {loading || !hasAgents ? 'Loading…' : `No agent “${agentId}” in this workspace.`}
      </div>
    )
  }
  return (
    <>
      <Header agent={agent} />
      {tab === 'messages' ? (
        <>
          <Messages agent={agent} />
          <Composer key={agent.id} agent={agent} />
        </>
      ) : (
        <CanvasTab agent={agent} />
      )}
    </>
  )
}
