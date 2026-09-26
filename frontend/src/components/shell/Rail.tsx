import { Icon } from '@/components/Icon'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS, type RailId } from '@/store/workspace'

const ITEMS: [RailId, string, string][] = [
  ['home', 'home', 'Home'],
  ['dms', 'chat_bubble', 'DMs'],
  ['calendar', 'calendar_month', 'Calendar'],
  ['files', 'description', 'Files'],
  ['agents', 'apps', 'Agents & tools'],
]

function railClick(id: RailId) {
  if (id === 'calendar') return navigate('/calendar')
  if (id === 'files') return navigate('/files')
  if (id === 'agents') return navigate('/agents')
  const s = useWS.getState()
  s.set({ rail: id })
  if (s.route.view !== 'dm' && s.route.view !== 'channel' && s.route.view !== 'class') navigate(`/dm/${s.lastDm}`)
}

export function Rail() {
  const rail = useWS((s) => s.rail)
  const isAdvisor = useWS((s) => s.route.view === 'advisor')
  return (
    <div className="flex w-16 flex-none flex-col items-center gap-3.5 bg-ink pt-3">
      <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-white text-sm font-black text-ink">BC</div>
      {ITEMS.map(([id, icon, label]) => {
        const on = !isAdvisor && rail === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => railClick(id)}
            className={cn('group relative flex w-16 cursor-pointer flex-col items-center gap-[3px] p-0', on ? 'text-cyan' : 'text-ink-3')}
          >
            <span className={cn('absolute top-1.5 left-0 h-6 w-[3px] rounded-r-[3px]', on ? 'bg-cyan' : 'bg-transparent')} />
            <span className={cn('flex size-9 items-center justify-center rounded-lg group-hover:bg-ink-7', on && 'bg-ink-7')}>
              <Icon name={icon} size={22} fill={on} />
            </span>
            <span className="text-[11px] font-bold">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
