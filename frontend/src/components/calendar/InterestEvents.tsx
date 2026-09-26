import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { SyntheticBadge } from '@/components/SyntheticBadge'
import { interestOf } from '@/lib/interestEvents'
import { fmtDayShort, fmtHM } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { CalendarItem } from '@/types'

/** Interest events (UI preview): hardcoded synthetic events matched to the student's interests in code. */
export const INTEREST_BLOCK = 'border-rose-400 bg-rose-50 text-ink'

// module-level so the zustand selector returns a stable reference (a fresh [] loops getSnapshot)
const NO_INTERESTS: string[] = []

export const useInterests = () => useWS((s) => s.students.find((x) => x.id === s.studentId)?.interests ?? NO_INTERESTS)

/** item → { ev, interest } for an interest event on the calendar, else undefined. */
export function useInterestOf() {
  const interests = useInterests()
  return (item: CalendarItem) => interestOf(item, interests)
}

/** "For your interests" row above the calendar: this range's matches, the student's interests, and "+ interest". */
export function InterestStrip({ events, hidden, onOpen }: { events: CalendarItem[]; hidden: boolean; onOpen: (item: CalendarItem, e: React.MouseEvent) => void }) {
  const interests = useInterests()
  const interestOfItem = useInterestOf()
  const addInterest = useWS((s) => s.addInterest)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    const typed = draft.replace(/\s+/g, ' ').trim()
    if (!typed) return
    setError('')
    try {
      await addInterest(typed)
      setDraft('')
      setAdding(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  if (hidden) return null
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-rose-200 bg-rose-50/60 px-2.5 py-1.5 text-[13px] text-ink">
      <Icon name="favorite" size={16} fill className="text-rose-500" />
      <b>For your interests</b>
      <span className="flex flex-wrap items-center gap-1">
        {interests.map((i) => (
          <span key={i} className="rounded-full border border-rose-200 bg-white px-2 text-[11px] font-bold text-rose-700">
            {i}
          </span>
        ))}
        {adding ? (
          <form onSubmit={(e) => (e.preventDefault(), void submit())} className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setAdding(false), setDraft(''))}
              placeholder="e.g. tennis"
              maxLength={40}
              className="h-5 w-24 rounded-full border border-rose-300 bg-white px-2 text-[11px] outline-none focus:border-rose-500"
            />
            <button type="submit" className="cursor-pointer text-[11px] font-bold text-link">
              Add
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex cursor-pointer items-center rounded-full border border-dashed border-rose-300 px-1.5 text-[11px] font-bold text-rose-700 hover:bg-white">
            <Icon name="add" size={12} /> interest
          </button>
        )}
      </span>
      <span className="mx-0.5 h-4 w-px bg-rose-200" />
      {events.length ? (
        events.map((it) => {
          const hit = interestOfItem(it)
          return (
            <button
              key={it.id}
              type="button"
              onClick={(e) => onOpen(it, e)}
              data-tip={hit ? `${hit.ev.host} · ${hit.ev.venue}` : undefined}
              className={cn('flex max-w-[340px] cursor-pointer items-center gap-1 rounded-md border px-1.5 py-px text-left text-xs hover:shadow-sm', INTEREST_BLOCK)}
            >
              <span className="flex-none font-bold text-rose-700">{hit?.interest}</span>
              <span className="truncate font-bold">{it.title}</span>
              <span className="flex-none text-ink-5">
                {fmtDayShort(it.start)} {fmtHM(it.start)}
              </span>
            </button>
          )
        })
      ) : (
        <span className="text-ink-5">{interests.length ? `Nothing on for ${interests.join(', ')} in this range.` : 'Add an interest to see matching events.'}</span>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
      <span className="ml-auto">
        <SyntheticBadge />
      </span>
    </div>
  )
}
