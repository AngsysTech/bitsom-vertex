import { useMemo } from 'react'
import { CalendarView } from '@/components/calendar/CalendarView'
import { ContextCards } from '@/components/cards/ContextCards'
import { OneOnOneCanvas } from '@/components/cards/OneOnOneCanvas'
import { StudyPlanCard } from '@/components/cards/StudyPlanCard'
import { Composer } from '@/components/chat/Composer'
import { Messages } from '@/components/chat/Messages'
import { Icon } from '@/components/Icon'
import { useScopeChips } from '@/hooks/useScopeChips'
import { latestCards, orderedCards } from '@/lib/cards'
import { COACH_STARTERS, DEFAULT_AGENT } from '@/lib/config'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS, type CanvasId } from '@/store/workspace'
import type { Agent, StudyPlanCard as StudyPlanCardT } from '@/types'

const startersOf = (agent: Agent) => (agent.id === DEFAULT_AGENT ? COACH_STARTERS : agent.starters)

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
        {agent.id === DEFAULT_AGENT && (
          <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line bg-soft px-2 text-xs text-ink" data-tip="Lectures you record in class channels">
            <Icon name="mic" size={14} className="text-ink-5" />
            Lectures
          </span>
        )}
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
        {startersOf(agent).map((q) => (
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

const CANVASES: { id: CanvasId; label: string; icon: string }[] = [
  { id: 'plan', label: 'Study plan', icon: 'checklist' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar_month' },
  { id: 'one_on_one', label: 'Weekly 1:1', icon: 'event_repeat' },
]

/** Coach canvas: the study plan (week tabs), the calendar, and the Weekly 1:1. */
function CoachCanvas() {
  const canvas = useWS((s) => s.canvas)
  const set = useWS((s) => s.set)
  const statePlan = useWS((s) => s.studentState?.plan)
  const msgs = useWS((s) => s.threads[DEFAULT_AGENT]?.messages)
  const send = useWS((s) => s.send)
  const plan = statePlan ?? (latestCards(msgs).study_plan?.card as StudyPlanCardT | undefined)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-1.5 px-5 pt-3.5 pb-1">
        {CANVASES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => set({ canvas: c.id })}
            className={cn('flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold', canvas === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-5')}
          >
            <Icon name={c.icon} size={16} />
            {c.label}
          </button>
        ))}
      </div>
      {canvas === 'calendar' ? (
        <div className="flex min-h-0 flex-1 flex-col px-5 pt-2 pb-4">
          <CalendarView />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {canvas === 'one_on_one' ? (
            <OneOnOneCanvas />
          ) : plan ? (
            <div className="max-w-[760px]">
              <StudyPlanCard card={plan} citations={[]} />
            </div>
          ) : (
            <div className="flex max-w-[640px] flex-col items-start gap-2 py-4 text-[13px] text-ink-5">
              <b className="text-lg text-ink">No plan yet</b>
              The coach builds one from your marks × past papers, placed around your classes and exams.
              <button type="button" onClick={() => (set({ tab: 'messages' }), void send(DEFAULT_AGENT, 'What should I study this week?'))} className="h-8 cursor-pointer rounded-md bg-ink px-3.5 font-bold text-white">
                What should I study this week?
              </button>
            </div>
          )}
        </div>
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
  const hasMessages = useWS((s) => !!s.threads[agentId]?.messages.length)

  if (!agent) {
    if (studentError) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-bad">Couldn’t load the workspace: {studentError}</div>
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-5">
        {loading || !hasAgents ? 'Loading…' : `${agentId.replace(/_/g, ' ')} is coming soon.`}
      </div>
    )
  }
  return (
    <>
      <Header agent={agent} />
      {tab === 'messages' ? (
        <>
          <Messages threadKey={agent.id} agent={agent} empty={<EmptyState agent={agent} />} />
          <Composer key={agent.id} threadKey={agent.id} placeholder={`Message ${agent.name}`} starters={hasMessages ? startersOf(agent) : undefined} />
        </>
      ) : agent.id === DEFAULT_AGENT ? (
        <CoachCanvas />
      ) : (
        <CanvasTab agent={agent} />
      )}
    </>
  )
}
