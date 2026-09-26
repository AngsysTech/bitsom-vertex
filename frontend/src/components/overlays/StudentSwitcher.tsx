import { Icon } from '@/components/Icon'
import { switchStudent } from '@/lib/actions'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'

export function StudentSwitcher() {
  const open = useWS((s) => s.switcherOpen)
  const students = useWS((s) => s.students)
  const current = useWS((s) => s.studentId)
  const set = useWS((s) => s.set)
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-[900]" onClick={() => set({ switcherOpen: false })} />
      <div className="fixed top-11 right-3 z-[901] w-[340px] overflow-hidden rounded-[10px] border border-line bg-white shadow-[0_12px_32px_rgba(15,23,42,.25)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <b className="text-[15px]">Switch student</b>
          <span className="rounded border border-line px-1.5 py-px text-[11px] text-ink-5">⌘K</span>
        </div>
        {students.map((s) => (
          <div
            key={s.id}
            onClick={() => switchStudent(s.id)}
            className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-soft', s.id === current ? 'bg-soft' : 'bg-white')}
          >
            <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink text-[13px] font-black text-white">{initials(s.name)}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="text-sm">{s.name}</b>
              <span className="text-xs text-ink-5">
                {s.program} · Sem {s.semester} · {s.careerGoal}
              </span>
            </div>
            {s.id === current && <Icon name="check" size={20} className="text-ink" />}
          </div>
        ))}
        <div className="border-t border-line px-4 py-2.5 text-xs text-ink-5">Switching reloads the workspace with that student’s data.</div>
      </div>
    </>
  )
}
