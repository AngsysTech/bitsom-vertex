import { Icon } from '@/components/Icon'
import { MOCK } from '@/lib/config'
import { initials } from '@/lib/format'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'

export function TopBar() {
  const student = useWS((s) => s.students.find((x) => x.id === s.studentId))
  const isAdvisor = useWS((s) => s.route.view === 'advisor')
  const lastDm = useWS((s) => s.lastDm)
  const set = useWS((s) => s.set)

  const toggle = (on: boolean) =>
    cn('h-[22px] cursor-pointer rounded px-2.5 text-xs font-bold', on ? 'bg-white/16 text-white' : 'bg-transparent text-ink-4')

  return (
    <div className="grid h-10 flex-none grid-cols-[324px_minmax(0,1fr)_324px] items-center gap-3 bg-ink-7 px-3">
      <div className="flex justify-end gap-0.5 text-ink-3">
        {[
          ['arrow_back', ''],
          ['arrow_forward', 'opacity-50'],
          ['schedule', ''],
        ].map(([icon, extra]) => (
          <span key={icon} data-tip="Coming soon" className={cn('flex size-7 cursor-default items-center justify-center rounded-md hover:bg-white/8', extra)}>
            <Icon name={icon!} size={18} />
          </span>
        ))}
      </div>
      <div
        data-tip="Coming soon"
        className="flex h-[26px] w-full max-w-[640px] cursor-not-allowed items-center gap-2 justify-self-center rounded-md border border-white/14 bg-white/9 px-2.5 text-[13px] text-ink-3"
      >
        <Icon name="search" size={16} />
        <span>Search handbook, courses, clubs…</span>
      </div>
      <div className="flex items-center justify-end gap-2.5">
        {MOCK && (
          <span
            data-tip="Canned mock data — set VITE_MOCK=false for the real backend"
            className="rounded border border-cyan px-1.5 py-px text-[10px] font-bold tracking-[.04em] whitespace-nowrap text-cyan uppercase"
          >
            Mock data
          </span>
        )}
        <span className="text-xs whitespace-nowrap text-ink-4">View as</span>
        <div className="flex gap-0.5 rounded-md bg-white/6 p-0.5">
          <button type="button" className={toggle(!isAdvisor)} onClick={() => isAdvisor && navigate(`/dm/${lastDm}`)}>
            Student
          </button>
          <button type="button" className={toggle(isAdvisor)} onClick={() => navigate('/advisor')}>
            Advisor
          </button>
        </div>
        <button
          type="button"
          onClick={() => set((s) => ({ switcherOpen: !s.switcherOpen }))}
          data-tip="Switch student  ⌘K"
          className="relative size-7 cursor-pointer rounded-md bg-ink-5 p-0 text-[11px] font-black text-white"
        >
          {student ? initials(student.name) : '…'}
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-ink-7 bg-ok" />
        </button>
      </div>
    </div>
  )
}
