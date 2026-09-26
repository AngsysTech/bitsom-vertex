import { RelevantCard } from '@/components/cards/RelevantCard'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { relevantKey, useWS } from '@/store/workspace'
import type { RelevantCard as RelevantCardT } from '@/types'

type Source = NonNullable<RelevantCardT['source']>

/** Stable fallback for the selectors below: a fresh `[]` per call makes zustand's getSnapshot loop forever. */
const NO_INTERESTS: string[] = []

/** First tap reframes through the student's first interest (pre-selected); the picker switches interest. */
function useStart(source: Source) {
  const interests = useWS((s) => s.students.find((x) => x.id === s.studentId)?.interests ?? NO_INTERESTS)
  const makeRelevant = useWS((s) => s.makeRelevant)
  return () => void makeRelevant(relevantKey(source), source, interests[0] ?? '')
}

/** The trigger. `prominent` on stuck handout sections; `icon` on weak-topic rows and plan blocks. */
export function MakeRelevantButton({ source, variant = 'default', className }: { source: Source; variant?: 'default' | 'prominent' | 'icon'; className?: string }) {
  const start = useStart(source)
  const open = useWS((s) => !!s.relevant[relevantKey(source)])
  const set = useWS((s) => s.set)
  const toggle = () => {
    if (!open) return start()
    set((s) => {
      const relevant = { ...s.relevant }
      delete relevant[relevantKey(source)]
      return { relevant }
    })
  }
  if (variant === 'icon')
    return (
      <button
        type="button"
        onClick={toggle}
        data-tip="Make it relevant"
        aria-label="Make it relevant"
        className={cn('flex size-6 flex-none cursor-pointer items-center justify-center rounded-md hover:bg-white', open ? 'bg-cyan-soft text-ink' : 'text-ink-5', className)}
      >
        <Icon name="auto_awesome" size={15} fill={open} />
      </button>
    )
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'inline-flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-bold',
        variant === 'prominent' ? 'bg-ink text-cyan hover:bg-ink-7' : 'border border-line bg-white text-ink hover:bg-soft',
        className,
      )}
    >
      <Icon name="auto_awesome" size={15} fill={variant === 'prominent'} />
      {open ? 'Hide' : 'Make it relevant'}
    </button>
  )
}

/** Inline result under the section / block / topic it came from: interest picker, progress row, the card. */
export function RelevantSlot({ source, className }: { source: Source; className?: string }) {
  const key = relevantKey(source)
  const st = useWS((s) => s.relevant[key])
  const interests = useWS((s) => s.students.find((x) => x.id === s.studentId)?.interests ?? NO_INTERESTS)
  const makeRelevant = useWS((s) => s.makeRelevant)
  const set = useWS((s) => s.set)
  if (!st) return null
  const close = () =>
    set((s) => {
      const relevant = { ...s.relevant }
      delete relevant[key]
      return { relevant }
    })
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-5">
        <span>Through:</span>
        {interests.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => void makeRelevant(key, source, i)}
            className={cn(
              'h-6 cursor-pointer rounded-full border px-2.5 font-bold',
              i === st.interest ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-5',
            )}
          >
            {i}
          </button>
        ))}
      </div>
      {st.status === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-ink-5">
          <Spinner size={13} />
          Reframing through {st.interest}…
        </div>
      )}
      {st.status === 'error' && (
        <div className="flex items-center gap-2 text-[13px] text-ink-5">
          <Icon name="error" size={16} className="text-bad" />
          <span>Couldn’t reframe: {st.error} —</span>
          <button type="button" onClick={() => void makeRelevant(key, source, st.interest)} className="cursor-pointer font-bold text-link">
            try again
          </button>
        </div>
      )}
      {st.card && <RelevantCard card={st.card} citations={[]} onClose={close} className={cn(st.status === 'loading' && 'opacity-50')} />}
    </div>
  )
}
