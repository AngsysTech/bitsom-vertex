import { useState } from 'react'
import { RelevantCard } from '@/components/cards/RelevantCard'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { errText, relevantKey, useWS, type RelevantState } from '@/store/workspace'
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

/** "Through:" chips. Tap one to reframe, × to drop it from the student's interests, or "Add" → type → Enter to save a new one and reframe through it. */
function InterestPicker({ source, st }: { source: Source; st: RelevantState }) {
  const key = relevantKey(source)
  const interests = useWS((s) => s.students.find((x) => x.id === s.studentId)?.interests ?? NO_INTERESTS)
  const makeRelevant = useWS((s) => s.makeRelevant)
  const addInterest = useWS((s) => s.addInterest)
  const removeInterest = useWS((s) => s.removeInterest)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = adding || !interests.length
  const cancel = () => {
    setAdding(false)
    setDraft('')
    setError(null)
  }
  const submit = async () => {
    const typed = draft.replace(/\s+/g, ' ').trim()
    if (!typed || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await addInterest(typed)
      cancel()
      // An existing interest typed in another case is kept as spelled on the list.
      void makeRelevant(key, source, saved.find((i) => i.toLowerCase() === typed.toLowerCase()) ?? typed)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (i: string) => {
    setError(null)
    try {
      await removeInterest(i)
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-5">
      <span>Through:</span>
      {interests.map((i) => (
        <span key={i} className="group relative inline-flex">
          <button
            type="button"
            onClick={() => void makeRelevant(key, source, i)}
            className={cn(
              'h-6 cursor-pointer rounded-full border px-2.5 font-bold',
              i === st.interest ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-5',
            )}
          >
            {i}
          </button>
          <button
            type="button"
            onClick={() => void remove(i)}
            aria-label={`Remove ${i} from your interests`}
            data-tip={`Remove ${i} from your interests`}
            className="absolute -top-1.5 -right-1.5 hidden size-4 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-ink-5 group-focus-within:flex group-hover:flex hover:border-bad hover:text-bad"
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      {editing ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            maxLength={40}
            readOnly={busy}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') {
                e.stopPropagation() // App's Escape would otherwise stop a recording
                cancel()
              }
            }}
            onBlur={() => !draft.trim() && cancel()}
            placeholder={interests.length ? 'Add an interest ↵' : 'Add an interest, e.g. cricket ↵'}
            aria-label="New interest"
            className="h-6 w-48 rounded-full border border-ink-5 bg-white px-2.5 font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-4 focus:border-ink read-only:opacity-60"
          />
          {busy && <Spinner size={12} />}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-tip="Add an interest and reframe through it"
          className="inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-full border border-dashed border-ink-4 pr-2.5 pl-1.5 font-bold text-ink-5 hover:border-ink-5 hover:text-ink"
        >
          <Icon name="add" size={14} />
          Add
        </button>
      )}
      {error && <span className="text-bad">{error}</span>}
    </div>
  )
}

/** Inline result under the section / block / topic it came from: interest picker, progress row, the card. */
export function RelevantSlot({ source, className }: { source: Source; className?: string }) {
  const key = relevantKey(source)
  const st = useWS((s) => s.relevant[key])
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
      <InterestPicker source={source} st={st} />
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
