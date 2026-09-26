import { useEffect, useMemo, useRef } from 'react'
import { ContextCards } from '@/components/cards/ContextCards'
import { OneOnOneCanvas } from '@/components/cards/OneOnOneCanvas'
import { Icon } from '@/components/Icon'
import { SyntheticBadge } from '@/components/SyntheticBadge'
import { useFileSource } from '@/hooks/useFileSource'
import { findCard } from '@/lib/cards'
import { fmtDate } from '@/lib/format'
import { CARD_AGENT, DOC_KIND_LABEL, fileIcon } from '@/lib/labels'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { WorkspaceFile } from '@/types'
import { Highlighted } from './Highlighted'

function Canvas({ file }: { file: Extract<WorkspaceFile, { kind: 'canvas' }> }) {
  if (file.cardType === 'one_on_one')
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <OneOnOneCanvas />
      </div>
    )
  return <CardCanvas file={file} />
}

function CardCanvas({ file }: { file: Extract<WorkspaceFile, { kind: 'canvas' }> }) {
  const threads = useWS((s) => s.threads)
  const state = useWS((s) => s.studentState)
  const agentName = useWS((s) => s.agents.find((a) => a.id === CARD_AGENT[file.cardType])?.name ?? 'the agent')
  const placed = useMemo(
    () => findCard(Object.values(threads).map((t) => t.messages), state, file.cardType),
    [threads, state, file.cardType],
  )
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {placed ? (
        <div className="max-w-[720px]">
          <ContextCards cards={[placed]} emptyText={null} />
        </div>
      ) : (
        <div className="text-sm text-ink-5">No canvas yet — ask {agentName} to create one.</div>
      )}
    </div>
  )
}

function Reader({ docId, sec }: { docId: string; sec: string | null }) {
  const entry = useWS((s) => s.docs[docId])
  const focus = useWS((s) => s.focusCite)
  const loadDoc = useWS((s) => s.loadDoc)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => loadDoc(docId), [docId, loadDoc])
  const ready = entry?.status === 'ready'
  useEffect(() => {
    const c = scroller.current
    if (!c || !ready) return
    const el = sec ? document.getElementById(`sec-${sec}`) : null
    c.scrollTop = el ? el.offsetTop - 16 : 0
  }, [sec, ready])

  if (!entry || entry.status === 'loading') return <div className="p-6 text-sm text-ink-5">Loading document…</div>
  if (entry.status === 'error')
    return (
      <div className="p-6 text-sm text-bad">
        Couldn’t load this document: {entry.error}{' '}
        <button type="button" className="cursor-pointer font-bold text-link" onClick={() => loadDoc(docId)}>
          try again
        </button>
      </div>
    )

  const doc = entry.doc
  const quote = focus && focus.docId === docId && focus.sectionId === sec ? focus.quote : null
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-60 flex-none flex-col gap-0.5 overflow-y-auto border-r border-line px-3 py-4">
        <span className="px-2 pb-2 text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase">Outline</span>
        {doc.sections.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => navigate(`/files/${doc.id}/${x.id}`)}
            className={cn('cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-soft', x.id === sec ? 'bg-soft font-bold' : 'font-normal')}
          >
            {x.heading}
          </button>
        ))}
      </div>
      <div ref={scroller} className="relative flex-1 overflow-y-auto px-7 pt-4 pb-[120px]">
        <div className="flex max-w-[720px] flex-col gap-2">
          {doc.sections.map((x) => {
            const hit = x.id === sec
            return (
              <section
                key={x.id}
                id={`sec-${x.id}`}
                className={cn('rounded-lg border px-4 py-3.5', hit ? 'border-cyan bg-cyan-soft' : 'border-transparent bg-white')}
              >
                <h2 className="mb-1.5 text-[17px] font-black">{x.heading}</h2>
                <p className="text-[15px] leading-6 text-pretty">
                  <Highlighted text={x.text} quote={hit ? quote : null} />
                </p>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function DocView({ docId, sec }: { docId: string; sec: string | null }) {
  const file = useWS((s) => s.files.find((f) => f.id === docId))
  const loadingFiles = useWS((s) => s.loadingStudent && !s.files.length)
  const src = useFileSource(file)
  const kindLabel = !file ? 'Documents' : file.kind === 'canvas' ? 'Canvases' : DOC_KIND_LABEL[file.docKind]

  if (loadingFiles) return <div className="p-6 text-sm text-ink-5">Loading…</div>
  return (
    <>
      <div className="flex flex-none flex-col gap-1 border-b border-line px-6 py-3">
        <div className="flex items-center gap-1 text-xs text-ink-5">
          <button type="button" onClick={() => navigate('/files')} className="cursor-pointer p-0 text-xs text-link">
            Files
          </button>
          <span>›</span>
          <span>{kindLabel}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Icon name={file ? fileIcon(file) : 'description'} size={22} className="text-ink-5" />
          <span className="text-xl font-black">{file?.title ?? docId}</span>
        </div>
        {file && (
          <div className="flex items-center gap-1.5 text-xs text-ink-5">
            <span>{src.label}</span>
            {src.synthetic && <SyntheticBadge />}
            {file.kind === 'document' && file.effectiveDate && <span>· Effective {fmtDate(file.effectiveDate)}</span>}
            <span>· Updated {fmtDate(file.updatedAt)}</span>
          </div>
        )}
      </div>
      {file?.kind === 'canvas' ? <Canvas file={file} /> : <Reader docId={docId} sec={sec} />}
    </>
  )
}
