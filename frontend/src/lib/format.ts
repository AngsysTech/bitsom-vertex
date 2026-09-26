export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export const fmtDate = (d: string) =>
  new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/** "Today" / "Yesterday" / "Thu 24 Sep" — for message day dividers. */
export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const key = (x: Date) => x.toDateString()
  if (key(d) === key(today)) return 'Today'
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (key(d) === key(y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export const dayKey = (iso: string) => new Date(iso).toDateString()

/** Compact age: "now", "5m", "3h", "2d". */
export function age(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return m + 'm'
  if (m < 1440) return Math.round(m / 60) + 'h'
  return Math.round(m / 1440) + 'd'
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name

/** Plain-text preview of a markdown message: drops citation markers and formatting. */
export const stripMd = (t: string) =>
  String(t || '')
    .replace(/\[C\d+\]/g, '')
    .replace(/[*`]/g, '')
    .replace(/\n- /g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m} min`
}

/** Exam weights may arrive as a fraction (0.2) or a percentage (20). */
export const asPercent = (x: number) => (x <= 1 ? Math.round(x * 100) : Math.round(x))
