import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { useAffectedCirculars } from '@/hooks/useAffectedCirculars'
import { age, fmtTime, stripMd } from '@/lib/format'
import { useCalendarRange } from '@/hooks/useCalendar'
import { askCoach } from '@/lib/actions'
import { COMING_SOON_AGENTS, KIND_STYLE, STUDY_KINDS } from '@/lib/labels'
import { addDays, fmtHM, minutesBetween, mondayOf, parseISO, sameDay, startOfDay } from '@/lib/time'
import { classPath, navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Agent } from '@/types'
import { TodayBlock } from './TodayBlock'

const row = (on: boolean) =>
  cn('mx-2 flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 hover:bg-ink-7', on ? 'bg-ink-7 font-bold text-cyan' : 'font-normal text-ink-3')

function SectionHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-2.5 flex h-7 items-center gap-1 px-4 font-bold text-ink-4', className)}>
      <Icon name="arrow_drop_down" size={16} />
      {children}
    </div>
  )
}

/** DM agents = everyone except club agents, which only reply inside threads. */
function useDmRows() {
  const agents = useWS((s) => s.agents)
  const threads = useWS((s) => s.threads)
  const route = useWS((s) => s.route)
  return useMemo(
    () =>
      agents
        .filter((a) => a.kind !== 'club')
        .map((a) => {
          const t = threads[a.id]
          const last = t?.sending ?? t?.messages.at(-1)
          return {
            agent: a,
            on: route.view === 'dm' && route.id === a.id,
            preview: last ? (last.role === 'student' ? 'You: ' : '') + stripMd(last.text) : a.tagline,
            time: last ? fmtTime(last.createdAt) : '',
          }
        }),
    [agents, threads, route],
  )
}

function AgentChip({ agent, presence = true }: { agent: Agent; presence?: boolean }) {
  return (
    <span className="relative flex size-5 flex-none items-center justify-center rounded-[5px] bg-ink-7 text-xs">
      {agent.emoji}
      {presence && <span className="absolute -right-[3px] -bottom-[3px] size-[9px] rounded-full border-2 border-ink bg-ok" />}
    </span>
  )
}

function ClassRows() {
  const classes = useWS((s) => s.classes)
  const channels = useWS((s) => s.channels)
  const route = useWS((s) => s.route)
  const recording = useWS((s) => s.recording?.courseCode)
  const jobs = useWS((s) => s.jobs)
  if (!classes.length) return <div className="pt-1 pr-4 pb-2 pl-9 text-xs text-ink-4">No registered classes</div>
  return (
    <>
      {classes.map((c) => {
        const on = route.view === 'class' && route.id === c.courseCode
        const name = channels.find((ch) => ch.id === c.channelId || ch.courseCode === c.courseCode)?.name ?? c.courseCode.toLowerCase().replace(/\s+/g, '-')
        const busy = Object.values(jobs).some((j) => j.courseCode === c.courseCode && (j.phase === 'uploading' || j.phase === 'processing'))
        return (
          <div
            key={c.courseCode}
            onClick={() => navigate(classPath(c.courseCode))}
            data-tip={`${c.courseCode} ${c.title} · ${c.faculty} · Slot ${c.slot}`}
            className={cn(row(on), !on && c.pendingActions > 0 && 'text-white')}
          >
            <span className="w-5 text-center text-[13px]">📘</span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {recording === c.courseCode && <span className="size-2 flex-none animate-rec rounded-full bg-bad" data-tip="Recording" />}
            {busy && <Spinner size={11} className="text-ink-4" />}
            {c.prepDue > 0 && <span className="size-1.5 flex-none rounded-full bg-warn" data-tip={`${c.prepDue} prep due before the next class`} />}
            {c.pendingActions > 0 && (
              <span className="flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-cyan px-1 text-[10px] font-black text-ink" data-tip={`${c.pendingActions} action${c.pendingActions > 1 ? 's' : ''} to review`}>
                {c.pendingActions}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

function HomeNav() {
  const dms = useDmRows()
  const channels = useWS((s) => s.channels)
  const route = useWS((s) => s.route)
  const annRead = useWS((s) => (s.studentId ? s.annRead[s.studentId] : true))
  const affected = useAffectedCirculars()
  const live = channels.filter((c) => c.kind === 'live')
  const soon = COMING_SOON_AGENTS.filter((a) => !dms.some((d) => d.agent.id === a.id))

  return (
    <>
      <SectionHead className="mt-1.5">Today</SectionHead>
      <TodayBlock />

      <SectionHead>Channels</SectionHead>
      {live.map((c) => {
        const on = route.view === 'channel' && route.id === c.id
        const unread = c.id === 'announcements' && affected.size > 0 && !annRead
        return (
          <div key={c.id} onClick={() => navigate(`/channel/${c.id}`)} className={cn(row(on), !on && unread && 'font-bold text-white')}>
            <span className="w-5 text-center text-[15px] opacity-80">#</span>
            <span className="flex-1">{c.name}</span>
            {unread && !on && <span className="size-2 rounded-full bg-white" />}
          </div>
        )
      })}

      <SectionHead>Classes</SectionHead>
      <ClassRows />

      <SectionHead>Direct messages</SectionHead>
      {dms.map((d) => (
        <div key={d.agent.id} onClick={() => navigate(`/dm/${d.agent.id}`)} className={row(d.on)}>
          <AgentChip agent={d.agent} />
          <span className="truncate">{d.agent.name}</span>
        </div>
      ))}
      <div data-tip="Advisor replies arrive through escalations" className="mx-2 flex h-7 cursor-default items-center gap-2 rounded-md px-2.5 hover:bg-ink-7">
        <span className="relative flex size-5 flex-none items-center justify-center rounded-[5px] bg-ink-5 text-white">
          <Icon name="person" size={15} />
          <span className="absolute -right-[3px] -bottom-[3px] size-[9px] rounded-full border-2 border-ink-4 bg-ink" />
        </span>
        <span>Human Advisor</span>
        <span className="text-xs text-ink-4">away</span>
      </div>
      {soon.length > 0 && (
        <>
          <div className="mx-4 mt-2 mb-1 flex items-center gap-2 text-[10px] font-bold tracking-[.06em] text-ink-5 uppercase">
            <span className="h-px flex-1 bg-ink-7" />
            coming soon
            <span className="h-px flex-1 bg-ink-7" />
          </div>
          {soon.map((a) => (
            <div key={a.id} data-tip="Coming soon" className="mx-2 flex h-7 cursor-not-allowed items-center gap-2 rounded-md px-2.5 opacity-45">
              <span className="flex size-5 flex-none items-center justify-center rounded-[5px] bg-ink-7 text-xs grayscale">{a.emoji}</span>
              <span className="flex-1 truncate">{a.name}</span>
              <Icon name="lock" size={14} />
            </div>
          ))}
        </>
      )}
    </>
  )
}

function DmsNav() {
  const dms = useDmRows()
  const [q, setQ] = useState('')
  const rows = dms.filter((d) => d.agent.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="px-3 pt-1 pb-2">
        <div className="flex h-[30px] items-center gap-1.5 rounded-md border border-ink-6 px-2">
          <Icon name="search" size={16} className="text-ink-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a DM…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-ink-4"
          />
        </div>
      </div>
      {rows.map((d) => (
        <div
          key={d.agent.id}
          onClick={() => navigate(`/dm/${d.agent.id}`)}
          className={cn('mx-2 flex cursor-pointer gap-2.5 rounded-md px-3 py-[9px] hover:bg-ink-7', d.on && 'bg-ink-7')}
        >
          <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-7 text-[19px]">{d.agent.emoji}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex justify-between gap-1.5">
              <span className={cn('font-bold', d.on ? 'text-cyan' : 'text-white')}>{d.agent.name}</span>
              <span className="flex-none text-[11px] text-ink-4">{d.time}</span>
            </div>
            <span className="truncate text-xs text-ink-4">{d.preview}</span>
          </div>
        </div>
      ))}
    </>
  )
}

/** The Calendar page's left strip: today, this week's planned vs done minutes, rebuild. */
function CalendarNav() {
  const monday = mondayOf(new Date())
  const entry = useCalendarRange(monday, addDays(monday, 6))
  const busy = useWS((s) => !!s.threads.academic_coach?.sending)
  const items = entry?.items ?? []
  const today = items.filter((i) => sameDay(parseISO(i.start), startOfDay(new Date()))).sort((a, b) => a.start.localeCompare(b.start))
  const study = items.filter((i) => STUDY_KINDS.includes(i.kind) && i.end)
  const mins = (list: typeof study) => list.reduce((n, i) => n + minutesBetween(i.start, i.end!), 0)
  const planned = mins(study)
  const done = mins(study.filter((i) => i.status === 'done'))
  const missed = study.filter((i) => i.status === 'missed').length
  return (
    <>
      <SectionHead className="mt-1.5">Today</SectionHead>
      {entry?.status === 'loading' && !items.length && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs text-ink-4">
          <Spinner size={11} /> Loading…
        </div>
      )}
      {entry?.status === 'ready' && !today.length && <div className="pt-1 pr-4 pb-2 pl-9 text-xs text-ink-4">Nothing on today</div>}
      {today.map((i) => (
        <div key={i.id} className="mx-2 flex min-h-7 items-center gap-2 rounded-md px-2.5 py-1 text-ink-3">
          <span className="size-2 flex-none rounded-full" style={{ background: KIND_STYLE[i.kind].dot }} />
          <span className="w-10 flex-none font-mono text-[11px] text-ink-4">{i.allDay || !i.end ? 'all day' : fmtHM(i.start)}</span>
          <span className={cn('min-w-0 flex-1 truncate', i.status === 'done' && 'line-through opacity-70')}>{i.title}</span>
        </div>
      ))}
      <SectionHead>This week</SectionHead>
      <div className="mx-4 flex flex-col gap-2 rounded-lg border border-ink-7 px-3 py-2.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-4">Study minutes</span>
          <span>
            <b className="text-[15px] text-white">{done}</b>
            <span className="text-ink-4"> / {planned} done</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-ink-7">
          <div className="h-full rounded-[3px] bg-cyan" style={{ width: `${planned ? Math.round((done / planned) * 100) : 0}%` }} />
        </div>
        <span className="text-[11px] text-ink-4">
          {study.length} block{study.length === 1 ? '' : 's'} · {study.filter((i) => i.status === 'done').length} done{missed ? ` · ${missed} missed` : ''}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => askCoach('What should I study this week?')}
        data-tip="Asks the Academic Coach: “What should I study this week?”"
        className="mx-4 mt-3 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-white/10 text-[13px] font-bold text-white hover:bg-white/15 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? <Spinner size={12} /> : <Icon name="autorenew" size={16} />}
        Rebuild plan
      </button>
    </>
  )
}

function FilesNav() {
  const filter = useWS((s) => s.filesFilter)
  const isFiles = useWS((s) => s.route.view === 'files')
  const set = useWS((s) => s.set)
  return (
    <>
      {(
        [
          ['all', 'folder', 'All files'],
          ['document', 'description', 'Documents'],
          ['canvas', 'dashboard', 'Canvases'],
        ] as const
      ).map(([id, icon, label]) => (
        <div
          key={id}
          onClick={() => {
            set({ filesFilter: id })
            navigate('/files')
          }}
          className={cn(row(isFiles && filter === id), 'h-[30px] gap-2.5')}
        >
          <Icon name={icon} size={18} />
          {label}
        </div>
      ))}
      <SectionHead className="mt-3">Starred</SectionHead>
      <div className="pt-1 pr-4 pb-2 pl-9 text-xs text-ink-4">Nothing starred yet</div>
    </>
  )
}

function AgentsNav() {
  const tab = useWS((s) => s.agentsTab)
  const isAgents = useWS((s) => s.route.view === 'agents')
  const set = useWS((s) => s.set)
  return (
    <>
      {(
        [
          ['agents', 'smart_toy', 'All agents'],
          ['connectors', 'hub', 'Connectors'],
        ] as const
      ).map(([id, icon, label]) => (
        <div
          key={id}
          onClick={() => {
            set({ agentsTab: id })
            navigate('/agents')
          }}
          className={cn(row(isAgents && tab === id), 'h-[30px] gap-2.5')}
        >
          <Icon name={icon} size={18} />
          {label}
        </div>
      ))}
    </>
  )
}

function AdvisorNav() {
  const tickets = useWS((s) => s.tickets)
  const loaded = useWS((s) => s.ticketsLoaded)
  const agents = useWS((s) => s.agents)
  const sel = useWS((s) => s.advisorSel)
  const set = useWS((s) => s.set)
  const selId = sel ?? (tickets.find((t) => t.status === 'open') ?? tickets[0])?.ticketId
  return (
    <>
      <SectionHead className="mt-0">Tickets</SectionHead>
      {!tickets.length && <div className="pt-1 pr-4 pb-2 pl-9 text-xs text-ink-4">{loaded ? 'No tickets yet' : 'Loading…'}</div>}
      {tickets.map((t) => {
        const on = t.ticketId === selId
        const ag = agents.find((a) => a.id === t.agentId)
        return (
          <div
            key={t.ticketId}
            onClick={() => set({ advisorSel: t.ticketId })}
            className={cn('mx-2 flex cursor-pointer flex-col gap-[3px] rounded-md px-3 py-2 hover:bg-ink-7', on && 'bg-ink-7')}
          >
            <div className="flex justify-between gap-1.5">
              <span className={cn('font-bold', on ? 'text-cyan' : 'text-white')}>{t.studentName}</span>
              <span className="text-[11px] text-ink-4">{age(t.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="flex min-w-0 text-xs text-ink-4">
                <span className="truncate">
                  {ag?.emoji} {ag?.name ?? t.agentId}
                </span>
                <span className="flex-none">&nbsp;· #{t.ticketId}</span>
              </span>
              <span className={cn('rounded-lg border px-[7px] py-px text-[10px] font-bold text-white', t.status === 'open' ? 'border-warn' : 'border-ok')}>
                {t.status === 'open' ? 'Open' : 'Answered'}
              </span>
            </div>
          </div>
        )
      })}
    </>
  )
}

export function Sidebar() {
  const rail = useWS((s) => s.rail)
  const isAdvisor = useWS((s) => s.route.view === 'advisor')
  const title = isAdvisor ? 'Advisor desk' : { home: 'BITS Campus', dms: 'Direct messages', calendar: 'Calendar', files: 'Files', agents: 'Agents & tools' }[rail]
  return (
    <div className="flex min-h-0 w-[260px] flex-none flex-col border-l border-ink-7 bg-ink text-[13px] text-ink-3">
      <div className="flex h-[50px] flex-none items-center justify-between pr-3 pl-4">
        <span className="flex items-center gap-0.5 text-[17px] font-black text-white">
          {title}
          {!isAdvisor && rail === 'home' && <Icon name="expand_more" size={18} />}
        </span>
        <span data-tip="Coming soon" className="flex size-[30px] cursor-not-allowed items-center justify-center rounded-lg bg-white/8 text-white">
          <Icon name="edit_square" size={18} />
        </span>
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {isAdvisor ? <AdvisorNav /> : rail === 'home' ? <HomeNav /> : rail === 'calendar' ? <CalendarNav /> : rail === 'dms' ? <DmsNav /> : rail === 'files' ? <FilesNav /> : <AgentsNav />}
      </div>
    </div>
  )
}
