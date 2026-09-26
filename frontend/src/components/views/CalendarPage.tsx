import { CalendarView } from '@/components/calendar/CalendarView'
import { SyntheticBadge } from '@/components/SyntheticBadge'

/** Rail → Calendar: the merged calendar (timetable, exam calendar, plan blocks, accepted actions). */
export function CalendarPage() {
  return (
    <>
      <div className="flex flex-none flex-col gap-0.5 border-b border-line px-6 pt-4 pb-3">
        <span className="text-xl font-black">Calendar</span>
        <span className="flex items-center gap-1.5 text-[13px] text-ink-5">
          Classes and exams from the timetable and exam calendar <SyntheticBadge />, with your study blocks, prep and actions placed around them.
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <CalendarView />
      </div>
    </>
  )
}
