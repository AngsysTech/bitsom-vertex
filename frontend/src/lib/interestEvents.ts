import type { CalendarItem, StudentId } from '@/types'
import { parseISO } from '@/lib/time'

/**
 * Interest events (UI only, 26 Sep 2026). A hardcoded, synthetic list of campus and sports events standing in
 * for a clubs/events connector we haven't built. Matching is plain code: an event shows on a student's calendar
 * only when one of its tags equals one of the student's interests. No model is involved and nothing is ranked.
 */
export interface InterestEvent {
  id: string
  title: string
  start: string // local ISO datetime
  end: string
  venue: string
  host: string
  blurb: string
  tags: string[] // lowercase; synonyms included so "f1" and "formula 1" both match
}

export const INTEREST_EVENTS: InterestEvent[] = [
  // tennis — add "tennis" as an interest to see these appear
  { id: 'ie-wimbledon', title: 'Wimbledon Classics Night: 2026 final on the big screen', start: '2026-09-27T18:00', end: '2026-09-27T21:00', venue: 'Main Auditorium', host: 'Tennis Club', blurb: 'Rewatch of this year’s Wimbledon final with live commentary from the club captains.', tags: ['tennis', 'wimbledon'] },
  { id: 'ie-tennis-clinic', title: 'Tennis Club: serve & volley clinic', start: '2026-10-01T17:30', end: '2026-10-01T19:00', venue: 'Courts 4–5', host: 'Tennis Club', blurb: 'Beginners welcome; rackets provided.', tags: ['tennis'] },
  // badminton
  { id: 'ie-badminton-open', title: 'Inter-hostel Badminton Open: doubles draw', start: '2026-09-27T07:30', end: '2026-09-27T09:30', venue: 'Sports Complex, Court 2', host: 'Badminton Club', blurb: 'Doubles bracket, walk-in pairs accepted until 07:15.', tags: ['badminton'] },
  { id: 'ie-badminton-clinic', title: 'Badminton Club: smash & footwork clinic', start: '2026-09-30T18:00', end: '2026-09-30T19:30', venue: 'Sports Complex, Court 1', host: 'Badminton Club', blurb: 'Coach-led drills for intermediate players.', tags: ['badminton'] },
  // music
  { id: 'ie-unplugged', title: 'Music Club: unplugged jam night', start: '2026-09-26T20:00', end: '2026-09-26T22:00', venue: 'Amphitheatre', host: 'Music Club', blurb: 'Bring an instrument or just sing along.', tags: ['music'] },
  { id: 'ie-open-mic', title: 'Open Mic Night', start: '2026-10-02T19:30', end: '2026-10-02T21:30', venue: 'Student Centre', host: 'Music Club', blurb: 'Five-minute slots, sign up at the door.', tags: ['music'] },
  // coffee
  { id: 'ie-cupping', title: 'Café Society: coffee cupping 101', start: '2026-10-03T16:00', end: '2026-10-03T17:00', venue: 'Student Centre Café', host: 'Café Society', blurb: 'Taste three single-origin brews side by side.', tags: ['coffee'] },
  // cricket
  { id: 'ie-t10', title: 'Inter-hostel T10 cricket league: round 1', start: '2026-09-27T07:00', end: '2026-09-27T11:00', venue: 'Main Ground', host: 'Cricket Club', blurb: 'Two matches back to back; spectators welcome.', tags: ['cricket'] },
  { id: 'ie-box-cricket', title: 'Box cricket night', start: '2026-10-01T20:00', end: '2026-10-01T22:00', venue: 'Indoor Arena', host: 'Cricket Club', blurb: 'Six-a-side, 5 overs, floodlit.', tags: ['cricket'] },
  // formula 1
  { id: 'ie-f1', title: 'Motorsport Club: F1 race-day watch party', start: '2026-10-04T16:30', end: '2026-10-04T18:30', venue: 'Lecture Hall 2', host: 'Motorsport Club', blurb: 'Big screen, live timing on the side screen.', tags: ['formula 1', 'f1', 'motorsport'] },
  // cooking
  { id: 'ie-cookoff', title: 'Hostel cook-off: 30-minute meals', start: '2026-10-03T17:30', end: '2026-10-03T19:00', venue: 'Hostel 4 Kitchen', host: 'Food Club', blurb: 'Teams of two, one stove, thirty minutes.', tags: ['cooking', 'food'] },
  // football
  { id: 'ie-5aside', title: 'Inter-hostel 5-a-side football', start: '2026-09-27T17:00', end: '2026-09-27T19:00', venue: 'Turf Ground', host: 'Football Club', blurb: 'Group stage, teams of five plus two subs.', tags: ['football', 'soccer'] },
  // photography
  { id: 'ie-photowalk', title: 'Photo walk: campus at golden hour', start: '2026-09-30T17:30', end: '2026-09-30T18:45', venue: 'Meet at the Library steps', host: 'Photography Club', blurb: 'Phones welcome; short editing session after.', tags: ['photography'] },
  // chess
  { id: 'ie-blitz', title: 'Chess Club: rapid & blitz night', start: '2026-10-01T20:00', end: '2026-10-01T22:00', venue: 'Library Seminar Room', host: 'Chess Club', blurb: '10+5 rapid, then 3+2 blitz.', tags: ['chess'] },
]

export const INTEREST_PREFIX = 'interest:'
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The student's interest (as they spelled it) that this event's tags match, or undefined. */
export function matchedInterest(ev: InterestEvent, interests: readonly string[]) {
  return interests.find((i) => ev.tags.includes(norm(i)))
}

/** Events in [from, to] (inclusive days) that match one of the interests, as calendar items. */
export function interestItems(studentId: StudentId, interests: readonly string[], from: Date, to: Date): CalendarItem[] {
  const lo = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const hi = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime()
  return INTEREST_EVENTS.filter((ev) => {
    const t = parseISO(ev.start).getTime()
    return t >= lo && t < hi && matchedInterest(ev, interests)
  }).map((ev) => ({
    id: `${INTEREST_PREFIX}${ev.id}`,
    studentId,
    kind: 'event',
    title: ev.title,
    start: ev.start,
    end: ev.end,
    source: { type: 'event', pickId: 'interest', eventId: ev.id },
  }))
}

/** The event behind an interest calendar item, with the interest it matched. */
export function interestOf(item: CalendarItem, interests: readonly string[]) {
  if (!item.id.startsWith(INTEREST_PREFIX)) return undefined
  const ev = INTEREST_EVENTS.find((e) => `${INTEREST_PREFIX}${e.id}` === item.id)
  const interest = ev && matchedInterest(ev, interests)
  return ev && interest ? { ev, interest } : undefined
}
