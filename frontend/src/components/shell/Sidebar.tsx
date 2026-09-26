import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { useAffectedCirculars } from '@/hooks/useAffectedCirculars'
import { age, fmtTime, stripMd } from '@/lib/format'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Agent } from '@/types'

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

function HomeNav() {
  const dms = useDmRows()
  const starred = useWS((s) => s.starred)
  const channels = useWS((s) => s.channels)
  const route = useWS((s) => s.route)
  const annRead = useWS((s) => (s.studentId ? s.annRead[s.studentId] : true))
  const affected = useAffectedCirculars()
  const starredRows = dms.filter((d) => starred.includes(d.agent.id))
  const live = channels.filter((c) => c.kind === 'live')
  const soon = channels.filter((c) => c.kind === 'coming_soon')

  return (
    <>
      <SectionHead className="mt-1.5">Starred</SectionHead>
      {!starredRows.length && <div className="pt-1 pr-4 pb-2 pl-9 text-xs leading-[17px] text-ink-4">Drag and drop important stuff here</div>}
      {starredRows.map((d) => (
        <div key={d.agent.id} onClick={() => navigate(`/dm/${d.agent.id}`)} className={row(d.on)}>
          <AgentChip agent={d.agent} presence={false} />
          <span className="truncate">{d.agent.name}</span>
        </div>
      ))}

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
      {soon.map((c) => (
        <div key={c.id} data-tip="Coming soon" className="mx-2 flex h-7 cursor-not-allowed items-center gap-2 rounded-md px-2.5 opacity-45">
          <span className="w-5 text-center text-[15px]">#</span>
          <span className="flex-1">{c.name}</span>
          <Icon name="lock" size={14} />
        </div>
      ))}

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
      <div data-tip="Coming soon" className="mx-2 flex h-7 cursor-not-allowed items-center gap-2 rounded-md px-2.5 opacity-55">
        <span className="flex size-5 flex-none items-center justify-center rounded-[5px] bg-ink-7">
          <Icon name="add" size={15} />
        </span>
        Invite people
      </div>
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
  const title = isAdvisor ? 'Advisor desk' : { home: 'BITS Campus', dms: 'Direct messages', files: 'Files', agents: 'Agents & tools' }[rail]
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
        {isAdvisor ? <AdvisorNav /> : rail === 'home' ? <HomeNav /> : rail === 'dms' ? <DmsNav /> : rail === 'files' ? <FilesNav /> : <AgentsNav />}
      </div>
    </div>
  )
}
