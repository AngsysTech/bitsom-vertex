import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useWS, type ThreadKey } from '@/store/workspace'

const FORMAT: [string, string][] = [
  ['format_bold', 'Bold'],
  ['format_italic', 'Italic'],
  ['strikethrough_s', 'Strikethrough'],
  ['link', 'Link'],
  ['format_list_bulleted', 'Bulleted list'],
  ['format_list_numbered', 'Numbered list'],
  ['code', 'Code'],
]

export interface PlusItem {
  icon: string
  label: string
  hint?: string
  onClick: () => void
}

/** Toolbar icon slot that isn't built yet: a tooltip, never a dead click (AGENTS.md §8). */
function Soon({ icon, tip, round }: { icon: string; tip: string; round?: boolean }) {
  return (
    <span data-tip={`${tip} · coming soon`} className={cn('flex size-7 cursor-default items-center justify-center text-ink-4 hover:bg-mist hover:text-ink-5', round ? 'rounded-full' : 'rounded')}>
      <Icon name={icon} size={18} />
    </span>
  )
}

function PlusMenu({ items }: { items: PlusItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Add"
        aria-expanded={open}
        data-tip={open ? undefined : items.map((it) => it.label).join(' · ')}
        onClick={() => setOpen(!open)}
        className={cn('flex size-7 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-5 transition-colors hover:bg-line hover:text-ink', open && 'bg-ink text-white hover:bg-ink hover:text-white')}
      >
        <Icon name="add" size={18} className={cn('transition-transform', open && 'rotate-45')} />
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-line bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,.18)]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => (setOpen(false), it.onClick())}
              className="group flex cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-ink hover:text-white"
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-md bg-mist text-ink-5 group-hover:bg-white/10 group-hover:text-white">
                <Icon name={it.icon} size={18} />
              </span>
              <span className="flex min-w-0 flex-col">
                <b className="text-[13px]">{it.label}</b>
                {it.hint && <span className="text-xs text-ink-5 group-hover:text-white/70">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Message box, Slack-style: formatting row, text, toolbar (+, @, then `tools`) and Send. */
export function Composer({ threadKey, placeholder, tools, plus, starters }: { threadKey: ThreadKey; placeholder: string; tools?: ReactNode; plus?: PlusItem[]; starters?: string[] }) {
  const [draft, setDraft] = useState('')
  const busy = useWS((s) => !!s.threads[threadKey]?.sending || s.loadingStudent)
  const send = useWS((s) => s.send)
  const canSend = !!draft.trim() && !busy
  const box = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, like Slack, up to a cap; then scroll inside.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const submit = () => {
    if (!canSend) return
    void send(threadKey, draft)
    setDraft('')
  }

  return (
    <div className="flex-none px-5 pb-5">
      {starters && starters.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {starters.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void send(threadKey, q)}
              className="h-7 cursor-pointer rounded-full border border-line bg-white px-3 text-xs font-bold text-ink hover:border-ink-5 hover:bg-soft disabled:cursor-wait disabled:opacity-60"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-ink-3 bg-white transition-[border-color,box-shadow] focus-within:border-ink-5 focus-within:shadow-[0_1px_8px_rgba(15,23,42,.08)]">
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5">
          {FORMAT.map(([icon, tip], i) => (
            <span key={icon} className="flex items-center">
              {(i === 3 || i === 4) && <span className="mx-1 h-4 w-px bg-line" />}
              <Soon icon={icon} tip={tip} />
            </span>
          ))}
        </div>
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="block max-h-[200px] min-h-[38px] w-full resize-none border-none bg-transparent px-3 py-2 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
        />
        {/* A size container, so labelled tools can shorten when the pane is narrow. */}
        <div className="@container flex items-center gap-1 px-1.5 pb-1.5">
          {plus ? <PlusMenu items={plus} /> : <Soon icon="add" tip="Attach" round />}
          <Soon icon="alternate_email" tip="Mention" />
          {tools && (
            <>
              <span className="mx-1 h-4 w-px bg-line" />
              {tools}
            </>
          )}
          <div className="ml-auto flex items-center gap-2.5">
            {draft && (
              <span className={cn('hidden text-[11px] whitespace-nowrap text-ink-4', tools ? '@2xl:inline' : 'sm:inline')}>
                <b className="text-ink-5">Shift + Enter</b> for a new line
              </span>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              data-tip={canSend ? 'Send · Enter' : undefined}
              className={cn('flex h-7 w-8 items-center justify-center rounded-md transition-colors', canSend ? 'cursor-pointer bg-ink text-white hover:bg-ink-7' : 'text-ink-3')}
            >
              <Icon name="send" size={18} fill />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
