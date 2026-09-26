import { useEffect, useMemo, useRef } from 'react'
import { ContextCards } from '@/components/cards/ContextCards'
import { Icon } from '@/components/Icon'
import { Highlighted } from '@/components/views/Highlighted'
import { freshestAudit, latestCards, orderedCards, stateCard } from '@/lib/cards'
import { CARD_AGENT } from '@/lib/labels'
import { navigate } from '@/lib/route'
import { useWS } from '@/store/workspace'

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-[18px] w-3/5 rounded bg-line" />
      {['82%', '70%', '90%'].map((w) => (
        <div key={w} className="flex flex-col gap-1.5">
          <div className="h-2.5 rounded bg-mist" style={{ width: w }} />
          <div className="h-1.5 rounded-[3px] bg-line" />
        </div>
      ))}
    </div>
  )
}

function useContextCards() {
  const route = useWS((s) => s.route)
  const state = useWS((s) => s.studentState)
  const coachMsgs = useWS((s) => s.threads[CARD_AGENT.audit]?.messages)
  const msgs = useWS((s) => (s.route.view === 'dm' ? s.threads[s.route.id]?.messages : undefined))
  return useMemo(() => {
    // The audit runs on student load and is cached in StudentState; the coach's thread copy carries citations.
    const audit = freshestAudit(latestCards(coachMsgs).audit, stateCard(state, 'audit'))
    if (route.view === 'channel') return audit ? [audit] : []
    const latest = latestCards(msgs)
    const isCoach = route.view === 'dm' && route.id === CARD_AGENT.audit
    // Coach DM always shows the current audit; other DMs fall back to it until they produce cards.
    if (audit && (isCoach || !Object.keys(latest).length)) latest.audit = audit
    return orderedCards(latest)
  }, [route, state, coachMsgs, msgs])
}

function CitationView() {
  const c = useWS((s) => s.activeCite)
  const entry = useWS((s) => (s.activeCite ? s.docs[s.activeCite.docId] : undefined))
  const set = useWS((s) => s.set)
  const scroller = useRef<HTMLDivElement>(null)
  const section = entry?.status === 'ready' ? entry.doc.sections.find((x) => x.id === c?.sectionId) : undefined

  useEffect(() => {
    const mark = scroller.current?.querySelector('mark')
    const panel = scroller.current?.closest('[data-panel-body]')
    if (mark instanceof HTMLElement && panel) panel.scrollTop = Math.max(0, mark.offsetTop - 120)
  }, [section])

  if (!c) return null
  return (
    <div ref={scroller} className="flex flex-col gap-2">
      <span className="text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase">Source {c.id}</span>
      <b className="text-base leading-[22px]">{c.docTitle}</b>
      <span className="text-[13px] text-ink-5">{c.sectionHeading}</span>
      <div className="mt-1.5 rounded-lg border border-line bg-soft px-3.5 py-3 text-sm leading-[23px] text-pretty">
        {entry?.status === 'error' ? (
          <>
            <Highlighted text={c.quote} quote={c.quote} />
            <div className="mt-2 text-xs text-bad">Couldn’t load the full section: {entry.error}</div>
          </>
        ) : section ? (
          <Highlighted text={section.text} quote={c.quote} />
        ) : (
          <span className="text-ink-5">Loading section…</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          set({ focusCite: c })
          navigate(`/files/${c.docId}/${c.sectionId}`)
        }}
        className="flex cursor-pointer items-center gap-1 self-start py-1 text-[13px] font-bold text-link"
      >
        Open in Files
        <Icon name="arrow_outward" size={16} />
      </button>
    </div>
  )
}

export function RightPanel() {
  const route = useWS((s) => s.route)
  const open = useWS((s) => s.panelOpen)
  const mode = useWS((s) => s.panelMode)
  const loading = useWS((s) => s.loadingStudent)
  const agentName = useWS((s) => (s.route.view === 'dm' ? s.agents.find((a) => a.id === (s.route as { id: string }).id)?.name : undefined))
  const set = useWS((s) => s.set)
  const cards = useContextCards()

  if (!open || (route.view !== 'dm' && route.view !== 'channel')) return null
  const citation = mode === 'citation'
  const title = citation ? 'Citation' : route.view === 'channel' ? 'Your audit' : (agentName ?? '')

  return (
    <div className="flex min-h-0 w-[380px] flex-none flex-col border-l border-line bg-white">
      <div className="flex h-[50px] flex-none items-center gap-2 border-b border-line pr-2.5 pl-4">
        {citation && (
          <button type="button" onClick={() => set({ panelMode: 'context' })} data-tip="Back to context" className="flex cursor-pointer p-0.5 text-ink-5">
            <Icon name="arrow_back" size={20} />
          </button>
        )}
        <span className="flex-1 truncate text-[15px]">
          <b>{title}</b> {!citation && <span className="text-ink-5">Context</span>}
        </span>
        <button
          type="button"
          onClick={() => set({ panelOpen: false })}
          data-tip="Hide panel"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-5 hover:bg-soft"
        >
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
      <div data-panel-body className="relative flex-1 overflow-y-auto p-4">
        {loading ? <Skeleton /> : citation ? <CitationView /> : <ContextCards cards={cards} />}
      </div>
    </div>
  )
}
