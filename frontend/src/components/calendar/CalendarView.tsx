import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { useCalendarRange } from '@/hooks/useCalendar'
import { CALENDAR_KINDS, KIND_STYLE, STUDY_KINDS } from '@/lib/labels'
import { classPath, navigate } from '@/lib/route'
import { addDays, fmtDayShort, fmtDM, fmtHM, isoDate, minutesBetween, mondayOf, parseISO, sameDay, startOfDay } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { CalendarItem, CalendarItemKind } from '@/types'

const START_H = 7
const END_H = 23
const DEFAULT_HOUR_PX = 42
const KIND_FILTERS: { label: string; kinds: CalendarItemKind[] }[] = [
  { label: 'Classes', kinds: ['class'] },
  { label: 'Exams', kinds: ['exam', 'quiz'] },
  { label: 'Study', kinds: ['study_block'] },
  { label: 'Prep', kinds: ['prep'] },
  { label: 'Actions', kinds: ['action'] },
  { label: 'Deadlines', kinds: ['deadline'] },
]

const start = (i: CalendarItem) => parseISO(i.start)
const isAllDay = (i: CalendarItem) => !!i.allDay || !i.end
const minutesOf = (i: CalendarItem) => (i.end ? minutesBetween(i.start, i.end) : 0)

/** Block line 1: "CS F212 · A-201" for classes, the topic for study blocks, the title otherwise. */
function shortTitle(i: CalendarItem) {
  if (i.kind === 'class' && i.courseCode) {
    const room = /\(([^)]+)\)\s*$/.exec(i.title)?.[1]
    return room ? `${i.courseCode} · ${room}` : i.courseCode
  }
  const t = i.courseCode && i.title.startsWith(i.courseCode) ? i.title.slice(i.courseCode.length).trim() || i.title : i.title
  return t.replace(/^Study: /, '')
}

/** Block line 2: the course title for classes, "CS F212 · 50 min" otherwise. */
function subTitle(i: CalendarItem, mins: number) {
  if (i.kind === 'class') return i.title.replace(i.courseCode ?? '', '').replace(/\([^)]*\)\s*$/, '').trim()
  return `${i.courseCode ? `${i.courseCode} · ` : ''}${mins} min`
}

/** Where an item came from — never invented (contracts §9b CalendarItem.source). */
function useSourceText() {
  const plan = useWS((s) => s.studentState?.plan)
  const lectures = useWS((s) => s.lectures.value)
  return (i: CalendarItem) => {
    const src = i.source
    if (src.type === 'timetable') return 'From the timetable'
    if (src.type === 'exam_calendar') return `From the exam calendar · ${src.examId}`
    if (src.type === 'plan_block') {
      const b = plan?.weeks.flatMap((w) => w.blocks).find((x) => x.id === src.planBlockId)
      return b ? `Plan block · why: ${b.why}` : 'Plan block'
    }
    if (src.type === 'event') return `Campus pick ${src.pickId}${src.eventId ? ` · event ${src.eventId}` : ''}`
    const lec = lectures?.find((l) => l.id === src.lectureId)
    return `From lecture ${lec ? fmtDM(lec.date) : src.lectureId} · action ${src.actionId}`
  }
}

/** Greedy lanes for overlapping blocks within one day. */
function layout(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => start(a).getTime() - start(b).getTime())
  const out: { item: CalendarItem; lane: number; lanes: number }[] = []
  let cluster: { item: CalendarItem; lane: number; end: number }[] = []
  let clusterEnd = 0
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    cluster.forEach((c) => out.push({ item: c.item, lane: c.lane, lanes }))
    cluster = []
  }
  for (const it of sorted) {
    const s = start(it).getTime()
    const e = it.end ? parseISO(it.end).getTime() : s + 30 * 60000
    if (cluster.length && s >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.end > s).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ item: it, lane, end: e })
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

function StatusIcon({ item }: { item: CalendarItem }) {
  if (item.status === 'done') return <Icon name="check_circle" size={12} fill className="text-ok" />
  if (item.status === 'missed') return <Icon name="cancel" size={12} fill className="text-bad" />
  return null
}

interface PopState {
  item: CalendarItem
  x: number
  y: number
}

function ItemPopover({ pop, onClose }: { pop: PopState; onClose: () => void }) {
  const live = useWS((s) => s.itemIndex[pop.item.id]) ?? pop.item
  const setItemStatus = useWS((s) => s.setItemStatus)
  const channel = useWS((s) => s.classes.find((c) => c.courseCode === live.courseCode))
  const sourceText = useSourceText()
  const editable = STUDY_KINDS.includes(live.kind)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: pop.x, top: pop.y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(8, Math.min(pop.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y, window.innerHeight - r.height - 8)) })
  }, [pop.x, pop.y])
  const when = isAllDay(live) ? `${fmtDayShort(live.start)} · all day` : `${fmtDayShort(live.start)} · ${fmtHM(live.start)}–${fmtHM(live.end!)}`
  return (
    <>
      <div className="fixed inset-0 z-[950]" onClick={onClose} />
      <div ref={ref} role="dialog" className="fixed z-[951] flex w-[300px] flex-col gap-2 rounded-lg border border-line bg-white p-3.5 shadow-[0_12px_32px_rgba(15,23,42,.22)]" style={pos}>
        <div className="flex items-start gap-2">
          <span className={cn('mt-0.5 rounded border px-1.5 py-px text-[10px] font-bold tracking-[.04em] uppercase', KIND_STYLE[live.kind].block)}>{KIND_STYLE[live.kind].label}</span>
          <b className="flex-1 text-sm leading-[19px]">{live.title}</b>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-5 hover:bg-soft">
            <Icon name="close" size={16} />
          </button>
        </div>
        <span className="text-xs text-ink-5">
          {when}
          {live.courseCode && ` · ${live.courseCode}`}
          {!isAllDay(live) && ` · ${minutesOf(live)} min`}
        </span>
        <span className="text-xs leading-[17px] text-ink">{sourceText(live)}</span>
        {editable ? (
          <div className="flex gap-1.5 pt-1">
            {(['done', 'missed', 'planned'] as const).map((st) => {
              const on = (live.status ?? 'planned') === st
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => void setItemStatus(live, st)}
                  className={cn(
                    'flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border text-xs font-bold capitalize',
                    on ? (st === 'done' ? 'border-ok bg-ok-soft text-ink' : st === 'missed' ? 'border-bad bg-bad-soft text-ink' : 'border-ink bg-ink text-white') : 'border-line bg-white text-ink hover:bg-soft',
                  )}
                >
                  <Icon name={st === 'done' ? 'check' : st === 'missed' ? 'close' : 'schedule'} size={14} />
                  {st}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-0.5 text-xs text-ink-5">
            <span className="flex items-center gap-1">
              <Icon name="lock" size={13} /> Read-only
            </span>
            {live.kind === 'class' && channel && (
              <button type="button" onClick={() => (onClose(), navigate(classPath(channel.courseCode)))} className="flex cursor-pointer items-center gap-0.5 font-bold text-link">
                Open channel <Icon name="arrow_outward" size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function Block({ item, style, onOpen }: { item: CalendarItem; style: CSSProperties; onOpen: (e: React.MouseEvent) => void }) {
  const fresh = useWS((s) => (s.freshItems[item.id] ? Date.now() - s.freshItems[item.id]! < 6000 : false))
  const sourceText = useSourceText()
  const mins = minutesOf(item)
  const tall = Number(style.height) >= 34
  return (
    <button
      type="button"
      onClick={onOpen}
      data-tip={sourceText(item)}
      style={style}
      className={cn(
        'absolute flex cursor-pointer flex-col overflow-hidden rounded-[5px] border px-1.5 py-[3px] text-left text-[11px] leading-[14px] hover:z-10 hover:shadow-md',
        KIND_STYLE[item.kind].block,
        item.status === 'done' && 'opacity-60',
        item.status === 'missed' && 'border-dashed opacity-70',
        fresh && 'z-10 animate-fresh',
      )}
    >
      <span className={cn('flex items-center gap-1 font-bold', item.status === 'done' && 'line-through')}>
        <StatusIcon item={item} />
        <span className="truncate">{shortTitle(item)}</span>
      </span>
      {tall && <span className="truncate text-ink-5">{subTitle(item, mins)}</span>}
    </button>
  )
}

function AllDayChip({ item, onOpen }: { item: CalendarItem; onOpen: (e: React.MouseEvent) => void }) {
  const sourceText = useSourceText()
  const fresh = useWS((s) => (s.freshItems[item.id] ? Date.now() - s.freshItems[item.id]! < 6000 : false))
  return (
    <button
      type="button"
      onClick={onOpen}
      data-tip={sourceText(item)}
      className={cn('flex w-full cursor-pointer items-center gap-1 truncate rounded-[4px] border px-1.5 py-px text-left text-[11px] font-bold', KIND_STYLE[item.kind].block, fresh && 'animate-fresh')}
    >
      <StatusIcon item={item} />
      <span className="truncate">{item.title}</span>
    </button>
  )
}

function WeekGrid({ monday, items, onOpen }: { monday: Date; items: CalendarItem[]; onOpen: (item: CalendarItem, e: React.MouseEvent) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const today = new Date()
  const scroller = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)
  // Fit 07:00–23:00 into the space available (classes and evening study blocks in one view).
  const [HOUR_PX, setHourPx] = useState(DEFAULT_HOUR_PX)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const fit = () => setHourPx(Math.max(26, Math.min(56, Math.floor(el.clientHeight / (END_H - START_H)))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const h = days.some((d) => sameDay(d, today)) ? Math.max(START_H, today.getHours() - 2) : 8
    el.scrollTop = (h - START_H) * HOUR_PX
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday.getTime()])
  const cols = { gridTemplateColumns: '48px repeat(7, minmax(0, 1fr))' }
  const allDay = days.map((d) => items.filter((i) => isAllDay(i) && sameDay(start(i), d)))
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">
      <div className="grid flex-none border-b border-line bg-soft" style={cols}>
        <span />
        {days.map((d) => {
          const on = sameDay(d, today)
          return (
            <div key={d.toISOString()} className={cn('flex items-baseline gap-1 border-l border-line px-2 py-1.5 text-xs', on ? 'font-black text-ink' : 'text-ink-5')}>
              {d.toLocaleDateString('en-GB', { weekday: 'short' })}
              <span className={cn('rounded-full px-1.5 text-[13px] font-bold', on ? 'bg-ink text-cyan' : 'text-ink')}>{d.getDate()}</span>
            </div>
          )
        })}
      </div>
      <div className="grid flex-none border-b border-line" style={cols}>
        <span className="px-1 py-1 text-right text-[10px] leading-4 text-ink-4">all-day</span>
        {allDay.map((list, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-0.5 border-l border-line p-0.5">
            {list.map((it) => (
              <AllDayChip key={it.id} item={it} onOpen={(e) => onOpen(it, e)} />
            ))}
          </div>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ ...cols, height: (END_H - START_H) * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: END_H - START_H }, (_, h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-ink-4" style={{ top: h * HOUR_PX }}>
                {h ? `${String(START_H + h).padStart(2, '0')}:00` : ''}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = items.filter((i) => !isAllDay(i) && sameDay(start(i), d))
            const isToday = sameDay(d, today)
            return (
              <div
                key={d.toISOString()}
                className={cn('relative border-l border-line', isToday && 'bg-cyan-soft/40')}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #E2E8F0 ${HOUR_PX - 1}px, #E2E8F0 ${HOUR_PX}px)` }}
              >
                {layout(timed).map(({ item, lane, lanes }) => {
                  const s = start(item)
                  const mins = Math.max(20, minutesOf(item) || 30)
                  const top = Math.max(0, ((s.getHours() + s.getMinutes() / 60 - START_H) * HOUR_PX))
                  const height = Math.max(20, (mins / 60) * HOUR_PX - 2)
                  return (
                    <Block
                      key={item.id}
                      item={item}
                      onOpen={(e) => onOpen(item, e)}
                      style={{ top: Math.min(top, (END_H - START_H) * HOUR_PX - height), height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                    />
                  )
                })}
                {isToday && today.getHours() >= START_H && today.getHours() < END_H && (
                  <div className="pointer-events-none absolute right-0 left-0 z-20 h-0.5 bg-bad" style={{ top: (today.getHours() + today.getMinutes() / 60 - START_H) * HOUR_PX }}>
                    <span className="absolute -top-[3px] -left-[4px] size-2 rounded-full bg-bad" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ first, items, onPick }: { first: Date; items: CalendarItem[]; onPick: (d: Date) => void }) {
  const gridStart = mondayOf(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const today = new Date()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-soft text-xs text-ink-5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="border-l border-line px-2 py-1.5 first:border-l-0">
            {d}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const list = items.filter((i) => sameDay(start(i), d))
          const counts = CALENDAR_KINDS.map((k) => [k, list.filter((i) => i.kind === k).length] as const).filter(([, n]) => n)
          const inMonth = d.getMonth() === first.getMonth()
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              data-tip={list.length ? `${list.length} item${list.length > 1 ? 's' : ''} · open week` : undefined}
              className={cn('flex min-h-[64px] cursor-pointer flex-col items-start gap-1 border-t border-l border-line p-1.5 text-left hover:bg-soft', !inMonth && 'bg-soft/60')}
            >
              <span className={cn('rounded-full px-1.5 text-xs font-bold', sameDay(d, today) ? 'bg-ink text-cyan' : inMonth ? 'text-ink' : 'text-ink-4')}>{d.getDate()}</span>
              <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                {counts.map(([k, n]) => (
                  <span key={k} className="flex items-center gap-0.5 text-[10px] text-ink-5">
                    <span className="size-1.5 rounded-full" style={{ background: KIND_STYLE[k].dot }} />
                    {n}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One calendar, three placements: the Calendar page, a class channel's Schedule tab (courseCode) and the
 * coach DM canvas. Classes and exams are read-only; study blocks, prep, actions and deadlines take a status.
 */
export function CalendarView({ courseCode, initialView = 'week', hideCourseFilter, className }: { courseCode?: string; initialView?: 'week' | 'month'; hideCourseFilter?: boolean; className?: string }) {
  const [view, setView] = useState(initialView)
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()))
  const [courses, setCourses] = useState<string[]>([])
  const [hidden, setHidden] = useState<CalendarItemKind[]>([])
  const [pop, setPop] = useState<PopState | null>(null)
  const classes = useWS((s) => s.classes)
  const statusError = useWS((s) => s.statusError)
  const set = useWS((s) => s.set)

  const monthFirst = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const range = view === 'week' ? { from: anchor, to: addDays(anchor, 6) } : { from: mondayOf(monthFirst), to: addDays(mondayOf(monthFirst), 41) }
  const entry = useCalendarRange(range.from, range.to, courseCode)
  const reload = useWS((s) => s.loadCalendar)
  const items = useMemo(
    () => (entry?.items ?? []).filter((i) => (!courses.length || (i.courseCode && courses.includes(i.courseCode))) && !hidden.includes(i.kind)),
    [entry?.items, courses, hidden],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const step = (dir: -1 | 1) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1)))
  const label =
    view === 'week'
      ? `${fmtDM(range.from)} – ${fmtDM(range.to)} ${range.to.getFullYear()}`
      : monthFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const open = (item: CalendarItem, e: React.MouseEvent) => setPop({ item, x: e.clientX + 12, y: e.clientY - 20 })
  const toggleKinds = (kinds: CalendarItemKind[]) => setHidden((h) => (kinds.every((k) => h.includes(k)) ? h.filter((k) => !kinds.includes(k)) : [...h, ...kinds]))

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2.5', className)}>
      <div className="flex flex-none flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-line">
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className="flex size-7 cursor-pointer items-center justify-center text-ink-5 hover:bg-soft">
            <Icon name="chevron_left" size={18} />
          </button>
          <button type="button" onClick={() => setAnchor(view === 'week' ? mondayOf(new Date()) : new Date())} className="h-7 cursor-pointer border-x border-line px-2.5 text-xs font-bold hover:bg-soft">
            Today
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next" className="flex size-7 cursor-pointer items-center justify-center text-ink-5 hover:bg-soft">
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
        <b className="text-[15px]">{label}</b>
        {entry?.status === 'loading' && (
          <span className="flex items-center gap-1.5 text-xs text-ink-5">
            <Spinner size={12} /> Loading calendar…
          </span>
        )}
        <div className="ml-auto flex gap-0.5 rounded-md bg-mist p-0.5">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => (setView(v), setAnchor((a) => (v === 'week' ? mondayOf(a) : new Date(a.getFullYear(), a.getMonth(), 1))))}
              className={cn('h-6 cursor-pointer rounded px-2.5 text-xs font-bold capitalize', view === v ? 'bg-white text-ink shadow-sm' : 'text-ink-5')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-1.5">
        {!hideCourseFilter &&
          classes.map((c) => {
            const on = courses.includes(c.courseCode)
            return (
              <button
                key={c.courseCode}
                type="button"
                onClick={() => setCourses((cs) => (on ? cs.filter((x) => x !== c.courseCode) : [...cs, c.courseCode]))}
                className={cn('h-6 cursor-pointer rounded-full border px-2.5 text-[11px] font-bold', on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-5')}
              >
                {c.courseCode}
              </button>
            )
          })}
        {!hideCourseFilter && <span className="mx-1 h-4 w-px bg-line" />}
        {KIND_FILTERS.map((f) => {
          const off = f.kinds.every((k) => hidden.includes(k))
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => toggleKinds(f.kinds)}
              className={cn('flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[11px] font-bold', off ? 'border-line bg-white text-ink-4 line-through' : 'border-line bg-soft text-ink')}
            >
              <span className="size-2 rounded-full" style={{ background: KIND_STYLE[f.kinds[0]!].dot }} />
              {f.label}
            </button>
          )
        })}
      </div>
      {entry?.status === 'error' && (
        <div className="flex flex-none items-center gap-2 text-[13px] text-ink-5">
          <Icon name="error" size={16} className="text-bad" />
          <span>Couldn’t load the calendar: {entry.error} —</span>
          <button
            type="button"
            onClick={() => void reload(`${isoDate(range.from)}|${isoDate(range.to)}|${courseCode ?? ''}`, { from: isoDate(range.from), to: isoDate(range.to), ...(courseCode ? { courseCode } : {}) })}
            className="cursor-pointer font-bold text-link"
          >
            try again
          </button>
        </div>
      )}
      {statusError && (
        <div className="flex flex-none items-center gap-2 text-[13px] text-ink-5">
          <Icon name="error" size={16} className="text-bad" />
          <span className="truncate">{statusError}</span>
          <button type="button" onClick={() => set({ statusError: null })} className="cursor-pointer text-xs font-bold text-link">
            dismiss
          </button>
        </div>
      )}
      {view === 'week' ? (
        <WeekGrid monday={anchor} items={items} onOpen={open} />
      ) : (
        <MonthGrid first={monthFirst} items={items} onPick={(d) => (setView('week'), setAnchor(mondayOf(startOfDay(d))))} />
      )}
      {pop && <ItemPopover pop={pop} onClose={() => setPop(null)} />}
    </div>
  )
}
