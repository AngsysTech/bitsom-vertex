import { useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { isoDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { CalendarItem } from '@/types'

/** Where the dialog opens: a day, and a time unless it's an all-day task. */
export interface TaskDraft {
  date: Date
  time?: string // "HH:MM"
}

const DURATIONS = [15, 25, 30, 45, 50, 60, 90, 120, 180, 240]
const field = 'h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-ink'

/**
 * The student's own task on the calendar (contracts v3.12, POST /calendar/tasks). It is kept exactly as
 * entered: plan rebuilds never move it and place study blocks around it.
 */
export function AddTaskDialog({ draft, courseCode, onClose, onAdded }: { draft: TaskDraft; courseCode?: string; onClose: () => void; onAdded: (item: CalendarItem) => void }) {
  const studentId = useWS((s) => s.studentId)
  const classes = useWS((s) => s.classes)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(isoDate(draft.date))
  const [allDay, setAllDay] = useState(!draft.time)
  const [time, setTime] = useState(draft.time ?? '19:00')
  const [minutes, setMinutes] = useState(60)
  const [course, setCourse] = useState(courseCode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!studentId || !title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const item = await api.addTask({
        studentId,
        title: title.trim(),
        start: allDay ? date : `${date}T${time}:00`,
        ...(allDay ? { allDay: true } : { minutes }),
        ...(course ? { courseCode: course } : {}),
      })
      onAdded(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[950] bg-ink/20" onClick={onClose} />
      <form
        role="dialog"
        aria-label="Add a task"
        onSubmit={submit}
        className="fixed top-1/2 left-1/2 z-[951] flex w-[340px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-line bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,.22)]"
      >
        <div className="flex items-center gap-2">
          <Icon name="add_task" size={18} className="text-violet-500" />
          <b className="flex-1 text-sm">Add a task</b>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-5 hover:bg-soft">
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs font-bold text-ink-5">
          What
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. DBMS assignment, gym, group study" className={field} />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink-5">
            Day
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
          <label className="flex flex-none items-end gap-1.5 pb-2 text-xs font-bold text-ink-5">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-3.5 accent-ink" />
            All day
          </label>
        </div>
        {!allDay && (
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink-5">
              Starts
              <input type="time" required step={900} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink-5">
              For
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field}>
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs font-bold text-ink-5">
          Course (optional)
          <select value={course} onChange={(e) => setCourse(e.target.value)} disabled={!!courseCode} className={cn(field, courseCode && 'bg-soft')}>
            <option value="">Not tied to a course</option>
            {classes.map((c) => (
              <option key={c.courseCode} value={c.courseCode}>
                {c.courseCode}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] leading-4 text-ink-5">
          Kept exactly as you add it. When your plan is rebuilt, study blocks go around it{course ? `, and its time counts toward that day’s study minutes` : ''}.
        </span>
        {error && (
          <span className="flex items-start gap-1.5 text-xs text-bad">
            <Icon name="error" size={14} className="mt-px flex-none" />
            {error}
          </span>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-md border border-line px-3 text-[13px] font-bold text-ink hover:bg-soft">
            Cancel
          </button>
          <button type="submit" disabled={!title.trim() || busy} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Spinner size={12} /> : <Icon name="add" size={16} />}
            Add to calendar
          </button>
        </div>
      </form>
    </>
  )
}
