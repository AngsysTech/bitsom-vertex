import { useEffect } from 'react'
import { addDays, isoDate, startOfDay } from '@/lib/time'
import { useWS, type CalendarEntry } from '@/store/workspace'
import type { CalendarItem } from '@/types'

/** GET /calendar for a date range (inclusive `to`), cached and refetched whenever the calendar version bumps. */
export function useCalendarRange(from: Date, to: Date, courseCode?: string): CalendarEntry | undefined {
  const f = isoDate(from)
  const t = isoDate(to)
  const key = `${f}|${t}|${courseCode ?? ''}`
  const entry = useWS((s) => s.calendar[key])
  const version = useWS((s) => s.calendarVersion)
  const ready = useWS((s) => !!s.studentId && !s.loadingStudent)
  const load = useWS((s) => s.loadCalendar)
  useEffect(() => {
    if (!ready) return
    const cur = useWS.getState().calendar[key]
    if (cur && cur.version >= version && cur.status !== 'error') return
    void load(key, { from: f, to: t, ...(courseCode ? { courseCode } : {}) })
  }, [key, version, ready, load, f, t, courseCode])
  return entry
}

const looked = new Set<string>()

/** A calendar item by id (e.g. the one an accepted action created); fetches the next six weeks once if unknown. */
export function useCalendarItem(id: string | undefined): CalendarItem | undefined {
  const item = useWS((s) => (id ? s.itemIndex[id] : undefined))
  const load = useWS((s) => s.loadCalendar)
  const version = useWS((s) => s.calendarVersion)
  useEffect(() => {
    if (!id || item || looked.has(`${id}@${version}`)) return
    looked.add(`${id}@${version}`)
    const today = startOfDay(new Date())
    void load(`lookup@${version}`, { from: isoDate(addDays(today, -7)), to: isoDate(addDays(today, 42)) })
  }, [id, item, load, version])
  return item
}
