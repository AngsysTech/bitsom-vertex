// Date helpers for the calendar, class channels and lecture timestamps. All local time.

export const DAY_MS = 86_400_000

/** ISO datetime or a date-only "YYYY-MM-DD" (read as local midnight, never UTC). */
export function parseISO(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday 00:00 of the week containing d. */
export function mondayOf(d: Date) {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local "YYYY-MM-DD". */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b)

/** "09:00" */
export const fmtHM = (d: Date | string) => {
  const x = typeof d === 'string' ? parseISO(d) : d
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`
}

/** "Mon" */
export const fmtDow = (d: Date | string) => (typeof d === 'string' ? parseISO(d) : d).toLocaleDateString('en-GB', { weekday: 'short' })

/** "Mon 28 Sep" */
export const fmtDayShort = (d: Date | string) =>
  (typeof d === 'string' ? parseISO(d) : d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** "28 Sep" */
export const fmtDM = (d: Date | string) => (typeof d === 'string' ? parseISO(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** "Week of Sep 21" — same label format as the backend planner. */
export const weekLabel = (monday: Date) => `Week of ${monday.toLocaleDateString('en-US', { month: 'short' })} ${monday.getDate()}`

/** Whole calendar days from today to the date (0 = today, 1 = tomorrow, negative = past). */
export const daysUntil = (iso: string, now = new Date()) => Math.round((startOfDay(parseISO(iso)).getTime() - startOfDay(now).getTime()) / DAY_MS)

/** "today" / "tomorrow" / "in 11 days" / "3 days ago" */
export function inDays(iso: string, now = new Date()) {
  const n = daysUntil(iso, now)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** "Today 09:00" / "Tomorrow 18:30" / "Mon 09:00" (within a week) / "Mon 5 Oct 09:00". */
export function whenLabel(iso: string, now = new Date()) {
  const d = parseISO(iso)
  const n = daysUntil(iso, now)
  const t = fmtHM(d)
  if (n === 0) return `Today ${t}`
  if (n === 1) return `Tomorrow ${t}`
  if (n > 1 && n < 7) return `${fmtDow(d)} ${t}`
  return `${fmtDayShort(d)} ${t}`
}

/** Seconds → "12:40" (or "1:02:03" past an hour). */
export function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/** Minutes between two ISO datetimes. */
export const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 60000))
