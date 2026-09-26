import { useEffect, useMemo } from 'react'
import { ActionsCard } from '@/components/cards/ActionsCard'
import { CoverageCard } from '@/components/cards/CoverageCard'
import { RelevantCard } from '@/components/cards/RelevantCard'
import { CardLabel, CardShell } from '@/components/cards/shared'
import { WeakTopicsCard } from '@/components/cards/WeakTopicsCard'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { useCalendarItem, useCalendarRange } from '@/hooks/useCalendar'
import { addDays, fmtDayShort, fmtHM, inDays, startOfDay } from '@/lib/time'
import { cn } from '@/lib/utils'
import { classKey, useWS } from '@/store/workspace'
import type { ActionItem, ActionsCard as ActionsCardT, CoverageCard as CoverageCardT } from '@/types'

/** The lecture whose cards the panel shows: the newest ready one for this course. */
export function useLatestLecture(courseCode: string) {
  const lectures = useWS((s) => s.lectures.value)
  const cls = useWS((s) => s.classes.find((c) => c.courseCode === courseCode))
  return useMemo(() => {
    const ready = lectures?.filter((l) => l.courseCode === courseCode && l.status === 'ready').sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0]
    return ready?.id ?? (cls?.latestLecture?.status === 'ready' ? cls.latestLecture.lectureId : undefined)
  }, [lectures, cls, courseCode])
}

/** Authoritative cards (GET /lectures/:id/cards); the thread's latest snapshot stands in while they load. */
export function useLectureCards(courseCode: string, lectureId: string | undefined) {
  const entry = useWS((s) => (lectureId ? s.cards[lectureId] : undefined))
  const msgs = useWS((s) => s.threads[classKey(courseCode)]?.messages)
  const loadCards = useWS((s) => s.loadCards)
  useEffect(() => {
    if (lectureId && !entry) void loadCards(lectureId)
  }, [lectureId, entry, loadCards])
  return useMemo(() => {
    if (entry?.value) return { ...entry.value, status: entry.status }
    let coverage: CoverageCardT | undefined
    let actions: ActionsCardT | undefined
    for (const m of msgs ?? [])
      for (const c of m.cards) {
        if (c.type === 'coverage' && (!lectureId || c.lectureId === lectureId)) coverage = c
        if (c.type === 'actions' && (!lectureId || c.lectureId === lectureId)) actions = c
      }
    return coverage || actions ? { coverage, actions, status: entry?.status ?? 'loading' } : entry ? { status: entry.status, error: entry.status === 'error' ? entry.error : undefined } : undefined
  }, [entry, msgs, lectureId])
}

function PrepRow({ a }: { a: ActionItem }) {
  const item = useCalendarItem(a.calendarItemId)
  const setItemStatus = useWS((s) => s.setItemStatus)
  const done = item?.status === 'done'
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-[13px] leading-[18px]', !item && 'cursor-default opacity-70')}>
      <input type="checkbox" className="mt-0.5 size-3.5 flex-none accent-ink" disabled={!item} checked={done} onChange={(e) => item && void setItemStatus(item, e.target.checked ? 'done' : 'planned')} />
      <span className={cn('min-w-0', done && 'text-ink-5 line-through')}>
        {a.title}
        {item && !item.allDay && item.end && <span className="text-xs text-ink-5"> · {fmtDayShort(item.start)} {fmtHM(item.start)}</span>}
      </span>
    </label>
  )
}

function NextSession({ courseCode, prep }: { courseCode: string; prep: ActionItem[] }) {
  const cls = useWS((s) => s.classes.find((c) => c.courseCode === courseCode))
  if (!cls) return null
  return (
    <CardShell className="gap-2">
      <CardLabel>Next session</CardLabel>
      {cls.nextSessionAt ? (
        <div className="flex items-baseline gap-2">
          <b className="text-[15px]">
            {fmtDayShort(cls.nextSessionAt)} · {fmtHM(cls.nextSessionAt)}
          </b>
          <span className="text-[13px] text-ink-5">
            {cls.nextSessionRoom} · {inDays(cls.nextSessionAt)}
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-ink-5">No more sessions on the timetable.</span>
      )}
      {prep.length ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <span className="text-xs font-bold text-ink-5">Prep due before it</span>
          {prep.map((a) => (
            <PrepRow key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <span className="text-xs text-ink-5">No prep accepted for this class.</span>
      )}
    </CardShell>
  )
}

function Exams({ courseCode }: { courseCode: string }) {
  const today = startOfDay(new Date())
  const entry = useCalendarRange(today, addDays(today, 110), courseCode)
  const exams = (entry?.items ?? []).filter((i) => i.kind === 'exam' || i.kind === 'quiz').slice(0, 3)
  return (
    <CardShell className="gap-2">
      <CardLabel>Exam countdown</CardLabel>
      {entry?.status === 'loading' && !exams.length && (
        <span className="flex items-center gap-2 text-[13px] text-ink-5">
          <Spinner size={12} /> Reading the exam calendar…
        </span>
      )}
      {entry?.status === 'ready' && !exams.length && <span className="text-[13px] text-ink-5">No more exams this semester.</span>}
      {exams.map((e, i) => (
        <div key={e.id} className="flex items-baseline justify-between gap-2 text-[13px]">
          <span className={cn(i === 0 && 'font-bold')}>
            <Icon name={e.kind === 'quiz' ? 'quiz' : 'event'} size={14} className="mr-1 align-[-2px] text-bad" />
            {e.title.replace(`${courseCode} `, '')}
          </span>
          <span className="flex-none text-ink-5">
            {fmtDayShort(e.start)} · <b className={cn(i === 0 ? 'text-ink' : 'font-normal')}>{inDays(e.start)}</b>
          </span>
        </div>
      ))}
    </CardShell>
  )
}

/** Right panel in a class channel ("CS F212 Context"). */
export function ClassContext({ courseCode }: { courseCode: string }) {
  const lectureId = useLatestLecture(courseCode)
  const cards = useLectureCards(courseCode, lectureId)
  const weak = useWS((s) => s.studentState?.weakTopics)
  const relevant = useWS((s) => [...s.relevantHistory].reverse().find((c) => c.course.startsWith(courseCode)))
  const lecturesLoaded = useWS((s) => s.lectures.status !== 'loading' || !!s.lectures.value)
  const prep = (cards?.actions?.items ?? []).filter((a) => a.kind === 'prep' && a.status === 'accepted')
  const flags: Record<string, number> = {}
  for (const c of cards?.coverage?.confusion ?? []) flags[c.markerId] = c.atSec
  return (
    <div className="flex flex-col gap-3">
      <NextSession courseCode={courseCode} prep={prep} />
      <Exams courseCode={courseCode} />
      {cards?.coverage ? (
        <CoverageCard card={cards.coverage} citations={[]} />
      ) : lectureId && cards?.status === 'error' ? (
        <CardShell className="gap-1.5">
          <CardLabel>Latest lecture</CardLabel>
          <span className="text-[13px] text-bad">Couldn’t load its coverage: {'error' in cards ? cards.error : ''}</span>
        </CardShell>
      ) : lectureId || !lecturesLoaded ? (
        <CardShell className="gap-1.5">
          <CardLabel>Latest lecture</CardLabel>
          <span className="flex items-center gap-2 text-[13px] text-ink-5">
            <Spinner size={12} /> Loading coverage…
          </span>
        </CardShell>
      ) : (
        <CardShell className="gap-1.5">
          <CardLabel>Latest lecture</CardLabel>
          <span className="text-[13px] leading-5 text-ink-5">
            No lecture yet. Hit <b className="text-ink">● Record lecture</b> (or press <kbd className="rounded border border-line bg-white px-1 font-mono text-[11px]">R</kbd>) when class starts, or <b className="text-ink">Upload</b> a recording you already have; coverage and actions land here.
          </span>
        </CardShell>
      )}
      {cards?.actions && <ActionsCard card={cards.actions} citations={[]} flags={flags} />}
      {weak && <WeakTopicsCard card={weak} citations={[]} course={courseCode} />}
      {relevant && <RelevantCard card={relevant} citations={[]} />}
    </div>
  )
}
