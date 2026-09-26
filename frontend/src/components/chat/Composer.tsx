import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useWS, type ThreadKey } from '@/store/workspace'

const FORMAT: [string, string][] = [
  ['format_bold', 'Bold'],
  ['format_italic', 'Italic'],
  ['link', 'Link'],
  ['format_list_bulleted', 'List'],
]

export interface PlusItem {
  icon: string
  label: string
  hint?: string
  onClick: () => void
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
        onClick={() => setOpen(!open)}
        className={cn('flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-line', open && 'bg-line text-ink')}
      >
        <Icon name="add" size={18} />
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-50 flex w-64 flex-col overflow-hidden rounded-lg border border-line bg-white py-1 shadow-[0_12px_32px_rgba(15,23,42,.2)]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => (setOpen(false), it.onClick())}
              className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-left hover:bg-soft"
            >
              <Icon name={it.icon} size={18} className="mt-px text-ink-5" />
              <span className="flex flex-col">
                <b className="text-[13px] text-ink">{it.label}</b>
                {it.hint && <span className="text-xs text-ink-5">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Message box. `left` sits beside it (class channels: Record lecture); `plus` fills the + menu. */
export function Composer({ threadKey, placeholder, left, plus, starters }: { threadKey: ThreadKey; placeholder: string; left?: ReactNode; plus?: PlusItem[]; starters?: string[] }) {
  const [draft, setDraft] = useState('')
  const busy = useWS((s) => !!s.threads[threadKey]?.sending || s.loadingStudent)
  const send = useWS((s) => s.send)
  const canSend = !!draft.trim() && !busy

  const submit = () => {
    if (!canSend) return
    void send(threadKey, draft)
    setDraft('')
  }

  return (
    <div className="flex-none px-5 pb-[18px]">
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
      <div className="flex items-end gap-2.5">
        {left}
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-ink-3 bg-soft">
          <div className="flex gap-0.5 px-1.5 py-1 text-ink-5">
            {FORMAT.map(([icon, tip]) => (
              <span key={icon} data-tip={`${tip} · coming soon`} className="flex size-7 cursor-default items-center justify-center rounded hover:bg-line">
                <Icon name={icon} size={18} />
              </span>
            ))}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={placeholder}
            rows={2}
            className="block min-h-12 w-full resize-none border-none bg-transparent px-3 py-1 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="flex items-center justify-between px-1.5 pt-1 pb-1.5">
            <div className="flex gap-0.5 text-ink-5">
              {plus ? (
                <PlusMenu items={plus} />
              ) : (
                <span data-tip="Coming soon" className="flex size-7 cursor-not-allowed items-center justify-center rounded-full hover:bg-line">
                  <Icon name="add" size={18} />
                </span>
              )}
              <span data-tip="Coming soon" className="flex size-7 cursor-not-allowed items-center justify-center rounded hover:bg-line">
                <Icon name="alternate_email" size={18} />
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-ink-4">Enter to send · Shift+Enter for a new line</span>
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                className={cn('flex h-7 w-8 items-center justify-center rounded text-white', canSend ? 'cursor-pointer bg-ink' : 'bg-ink-4')}
              >
                <Icon name="send" size={18} fill />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
