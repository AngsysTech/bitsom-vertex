import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { dayKey, dayLabel } from '@/lib/format'
import { useWS, type ThreadKey } from '@/store/workspace'
import type { Agent, Message } from '@/types'
import { ErrorMarker, MessageRow } from './MessageRow'

/** A local-only row (e.g. an "I'm stuck" flag) merged into the timeline by time. */
export interface ExtraRow {
  key: string
  at: string
  node: ReactNode
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

export function Divider({ label }: { label: string }) {
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

/**
 * A thread: server messages + local rows (failed sends, extra rows) with day dividers, the optimistic
 * send + thinking row, and a live footer (lecture jobs). Scrolls to the bottom on change, or to
 * `scrollTo` (a message id / data-msg-id) with a flash.
 */
export function Messages({
  threadKey,
  agent,
  empty,
  inClass,
  extra = [],
  footer,
  footerKey,
}: {
  threadKey: ThreadKey
  agent: Agent
  empty?: ReactNode
  inClass?: string
  extra?: ExtraRow[]
  footer?: ReactNode
  footerKey?: string
}) {
  const th = useWS((s) => s.threads[threadKey])
  const loading = useWS((s) => s.loadingStudent) || !th || (th.status === 'loading' && !th.messages.length)
  const studentId = useWS((s) => s.studentId)
  const retry = useWS((s) => s.retry)
  const loadThread = useWS((s) => s.loadThread)
  const scrollTo = useWS((s) => s.scrollTo)
  const set = useWS((s) => s.set)
  const ref = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const count = th ? th.messages.length + th.failed.length + extra.length : 0
  const sending = !!th?.sending
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [studentId, threadKey, count, sending, loading, footerKey])
  useEffect(() => {
    if (!scrollTo) return
    const el = ref.current?.querySelector(`[data-msg-id="${CSS.escape(scrollTo)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(scrollTo)
    set({ scrollTo: null })
    const t = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(t)
  }, [scrollTo, count, footerKey, set])

  if (loading || !th)
    return (
      <div ref={ref} className="flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2">
        <Skeleton />
      </div>
    )
  if (th.status === 'error' && !th.messages.length)
    return (
      <div ref={ref} className="flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2">
        <ErrorMarker error={th.error ?? 'Could not load this thread'} onRetry={() => void loadThread(threadKey)} />
        {footer}
      </div>
    )

  // Merge server messages and local rows by time; failed sends sit after the message they followed.
  type Item = { kind: 'msg'; m: Message } | { kind: 'extra'; r: ExtraRow }
  const items: Item[] = [...th.messages.map((m) => ({ kind: 'msg' as const, m })), ...extra.map((r) => ({ kind: 'extra' as const, r }))].sort((a, b) =>
    (a.kind === 'msg' ? a.m.createdAt : a.r.at).localeCompare(b.kind === 'msg' ? b.m.createdAt : b.r.at),
  )
  const known = new Set(th.messages.map((m) => m.id))
  const out: ReactNode[] = []
  const failedAt = (after: string | null) =>
    th.failed
      .filter((f) => f.afterId === after || (after === '$end' && f.afterId !== null && !known.has(f.afterId)))
      .forEach((f) => {
        const pseudo: Message = { id: f.id, threadId: '', role: 'student', createdAt: new Date().toISOString(), text: f.text, citations: [], cards: [], trace: [] }
        out.push(
          <Fragment key={f.id}>
            <MessageRow m={pseudo} dmAgent={agent} />
            <ErrorMarker error={f.error} onRetry={() => retry(threadKey, f.id)} />
          </Fragment>,
        )
      })
  let day = ''
  failedAt(null)
  for (const it of items) {
    const at = it.kind === 'msg' ? it.m.createdAt : it.r.at
    if (dayKey(at) !== day) {
      day = dayKey(at)
      out.push(<Divider key={`d:${day}`} label={dayLabel(at)} />)
    }
    if (it.kind === 'msg') {
      out.push(<MessageRow key={it.m.id} m={it.m} dmAgent={agent} inClass={inClass} highlight={flash === it.m.id} />)
      failedAt(it.m.id)
    } else out.push(<Fragment key={it.r.key}>{it.r.node}</Fragment>)
  }
  failedAt('$end')
  const isEmpty = !th.messages.length && !th.failed.length && !th.sending && !extra.length

  return (
    <div ref={ref} className="flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2">
      {isEmpty && empty}
      {out}
      {th.sending && (
        <>
          {!th.messages.length && <Divider label="Today" />}
          <MessageRow m={th.sending} dmAgent={agent} inClass={inClass} />
          <Thinking agent={agent} />
        </>
      )}
      {footer}
    </div>
  )
}
