import { useEffect, useMemo } from 'react'
import { Icon } from '@/components/Icon'
import { useAffectedCirculars } from '@/hooks/useAffectedCirculars'
import { fmtDate } from '@/lib/format'
import { navigate } from '@/lib/route'
import { useWS } from '@/store/workspace'

/** #announcements: circulars from the Academic Office, oldest first, read-only. */
export function ChannelView({ channelId }: { channelId: string }) {
  const channel = useWS((s) => s.channels.find((c) => c.id === channelId))
  const files = useWS((s) => s.files)
  const docs = useWS((s) => s.docs)
  const loadDoc = useWS((s) => s.loadDoc)
  const affected = useAffectedCirculars()

  const circulars = useMemo(
    () =>
      files
        .flatMap((f) => (f.kind === 'document' && f.docKind === 'circular' ? [f] : []))
        .sort((a, b) => (a.effectiveDate ?? a.updatedAt).localeCompare(b.effectiveDate ?? b.updatedAt)),
    [files],
  )
  useEffect(() => circulars.forEach((c) => loadDoc(c.id)), [circulars, loadDoc])

  if (channel && channel.kind !== 'live')
    return <div className="flex flex-1 items-center justify-center text-sm text-ink-5"># {channel.name} is coming soon.</div>

  return (
    <>
      <div className="flex-none border-b border-line px-5 py-3">
        <div className="text-lg font-black"># {channel?.name ?? channelId}</div>
        <div className="mt-0.5 text-[13px] text-ink-5">{channel?.description ?? 'Circulars from the Academic Office · read-only'}</div>
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        {!circulars.length && <div className="px-5 py-2 text-sm text-ink-5">No circulars yet.</div>}
        {circulars.map((c) => {
          const entry = docs[c.id]
          return (
            <div key={c.id} className="flex gap-2.5 px-5 py-2.5 hover:bg-soft">
              <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink text-white">
                <Icon name="account_balance" size={20} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex items-baseline gap-2">
                  <b className="text-[15px]">Academic Office</b>
                  {c.effectiveDate && <span className="text-xs text-ink-5">Effective {fmtDate(c.effectiveDate)}</span>}
                </div>
                <button type="button" onClick={() => navigate(`/files/${c.id}`)} className="cursor-pointer text-left text-[15px] font-bold text-ink hover:underline">
                  {c.title}
                </button>
                <div className="text-[15px] leading-[22px] text-pretty">
                  {entry?.status === 'ready' ? (
                    entry.doc.sections.map((s) => s.text).join(' ')
                  ) : entry?.status === 'error' ? (
                    <span className="text-sm text-bad">Couldn’t load: {entry.error}</span>
                  ) : (
                    <span className="text-sm text-ink-4">Loading…</span>
                  )}
                </div>
                {affected.has(c.id) && (
                  <span className="mt-1 inline-flex h-[22px] items-center gap-1 self-start rounded-full border border-warn bg-warn-soft px-[9px] text-xs font-bold">
                    <Icon name="fact_check" size={14} className="text-warn-ink" />
                    Affects your audit
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mx-5 mb-[18px] flex flex-none items-center gap-2 rounded-lg border border-line bg-soft px-3.5 py-3 text-[13px] text-ink-5">
        <Icon name="lock" size={16} />
        This channel is read-only. Circulars are posted by the Academic Office.
      </div>
    </>
  )
}
