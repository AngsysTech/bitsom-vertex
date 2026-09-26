import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Agent } from '@/types'

const FORMAT: [string, string][] = [
  ['format_bold', 'Bold'],
  ['format_italic', 'Italic'],
  ['link', 'Link'],
  ['format_list_bulleted', 'List'],
]

export function Composer({ agent }: { agent: Agent }) {
  const [draft, setDraft] = useState('')
  const busy = useWS((s) => !!s.threads[agent.id]?.sending || s.loadingStudent)
  const send = useWS((s) => s.send)
  const canSend = !!draft.trim() && !busy

  const submit = () => {
    if (!canSend) return
    void send(agent.id, draft)
    setDraft('')
  }

  return (
    <div className="flex-none px-5 pb-[18px]">
      <div className="overflow-hidden rounded-lg border border-ink-3 bg-soft">
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
          placeholder={`Message ${agent.name}`}
          rows={2}
          className="block min-h-12 w-full resize-none border-none bg-transparent px-3 py-1 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
        />
        <div className="flex items-center justify-between px-1.5 pt-1 pb-1.5">
          <div className="flex gap-0.5 text-ink-5">
            <span data-tip="Coming soon" className="flex size-7 cursor-not-allowed items-center justify-center rounded-full hover:bg-line">
              <Icon name="add" size={18} />
            </span>
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
  )
}
