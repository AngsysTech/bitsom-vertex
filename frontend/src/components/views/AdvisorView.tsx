import { useState } from 'react'
import { CitePill } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { ADVISOR_NAME } from '@/lib/config'
import { age, firstName, fmtTime, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Ticket } from '@/types'

function ReplyBox({ ticket }: { ticket: Ticket }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const replyTicket = useWS((s) => s.replyTicket)

  const submit = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      await replyTicket(ticket.ticketId, text)
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[868px] flex-none px-6 pb-[18px]">
      <div className="overflow-hidden rounded-lg border border-ink-3 bg-soft">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={`Reply to ${firstName(ticket.studentName)}…`}
          rows={3}
          className="block w-full resize-none border-none bg-transparent px-3 py-2.5 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
        />
        <div className="flex items-center justify-end gap-2.5 px-2 py-1.5">
          {error && <span className="mr-auto text-xs text-bad">Couldn’t send: {error}</span>}
          <span className="text-[11px] text-ink-4">Reply goes to the student’s DM and closes the ticket</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className={cn('h-[30px] rounded-md px-3.5 text-[13px] font-bold text-white', busy || !draft.trim() ? 'bg-ink-4' : 'cursor-pointer bg-ink')}
          >
            {busy ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AdvisorView() {
  const tickets = useWS((s) => s.tickets)
  const sel = useWS((s) => s.advisorSel)
  const students = useWS((s) => s.students)
  const agents = useWS((s) => s.agents)
  const error = useWS((s) => s.ticketsError)
  const loaded = useWS((s) => s.ticketsLoaded)
  const t = tickets.find((x) => x.ticketId === (sel ?? (tickets.find((x) => x.status === 'open') ?? tickets[0])?.ticketId))

  if (!t)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-5">
        {error ? (
          <span className="text-bad">Couldn’t load the inbox: {error}</span>
        ) : !loaded ? (
          'Loading tickets…'
        ) : tickets.length ? (
          'Select a ticket'
        ) : (
          'No tickets yet'
        )}
      </div>
    )

  const stu = students.find((x) => x.id === t.studentId)
  const ag = agents.find((a) => a.id === t.agentId)
  const open = t.status === 'open'
  return (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-line px-6 py-3">
        <span className="text-lg font-black">Ticket #{t.ticketId}</span>
        <span className={cn('rounded-full border px-2 py-px text-[11px] font-bold', open ? 'border-warn bg-warn-soft' : 'border-ok bg-ok-soft')}>
          {open ? 'Open' : 'Answered'}
        </span>
        <span className="text-[13px] text-ink-5">
          {t.studentName} · via {ag?.emoji} {ag?.name ?? t.agentId} · {age(t.createdAt) === 'now' ? 'just now' : `${age(t.createdAt)} ago`}
        </span>
      </div>
      <div className="flex max-w-[820px] flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-5">
        <div className="flex gap-2.5">
          <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink text-[13px] font-black text-white">{initials(t.studentName)}</span>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <b className="text-[15px]">{t.studentName}</b>
              {stu && (
                <span className="text-xs text-ink-5">
                  {stu.program} · Sem {stu.semester}
                </span>
              )}
            </div>
            <span className="text-[15px] leading-[22px]">{t.question}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-soft px-4 py-3.5">
          <span className="text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase">{ag?.emoji} Agent summary</span>
          <span className="text-[15px] leading-[22px] text-pretty">{t.agentSummary}</span>
          {t.citations.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {t.citations.map((c) => (
                <CitePill key={c.id} citation={c} className="mx-0 h-6 gap-1.5 border-line bg-white py-0 pr-2.5 pl-1 text-xs font-normal">
                  <span className="inline-flex h-[18px] items-center rounded-full border border-cyan bg-cyan-soft px-1.5 text-[11px] font-bold">{c.id}</span>
                  {c.docTitle} › {c.sectionHeading}
                </CitePill>
              ))}
            </div>
          )}
        </div>
        {t.reply && (
          <div className="flex gap-2.5">
            <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-5 text-white">
              <Icon name="person" size={20} />
            </span>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <b className="text-[15px]">{ADVISOR_NAME}</b>
                <span className="text-xs text-ink-5">{fmtTime(t.reply.at)}</span>
              </div>
              <span className="text-[15px] leading-[22px]">{t.reply.text}</span>
            </div>
          </div>
        )}
      </div>
      {open && <ReplyBox key={t.ticketId} ticket={t} />}
    </>
  )
}
