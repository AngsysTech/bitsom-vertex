import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { pasteTranscript } from '@/store/companion'
import { useWS } from '@/store/workspace'

/** The text fallback path (Lecture.source "transcript"): paste what was said, process it like a recording. */
export function PasteDialog() {
  const paste = useWS((s) => s.paste)
  const set = useWS((s) => s.set)
  const [text, setText] = useState('')
  const [sample, setSample] = useState<{ file: string; text: string } | null>(null)
  const courseCode = paste?.courseCode
  useEffect(() => {
    setText('')
    setSample(null)
    if (!courseCode) return
    // The dataset ships synthetic transcripts as the demo's fallback (backend/app/data/lectures).
    import('@/api/mock/dataset').then(
      (d) => {
        const l = d.sampleLecture(courseCode)
        if (l) setSample({ file: l.file, text: l.text })
      },
      () => {},
    )
  }, [courseCode])
  if (!paste) return null
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const close = () => set({ paste: null })
  const submit = () => {
    if (!text.trim()) return
    void pasteTranscript(paste.courseCode, text)
    close()
  }
  return (
    <>
      <div className="fixed inset-0 z-[960] bg-ink/40" onClick={close} />
      <div role="dialog" aria-label="Paste transcript" className="fixed top-1/2 left-1/2 z-[961] flex w-[640px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-line bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,.35)]">
        <div className="flex items-center gap-2">
          <Icon name="description" size={20} className="text-ink-5" />
          <b className="text-[17px]">Paste transcript · {paste.courseCode}</b>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-5 hover:bg-soft">
            <Icon name="close" size={18} />
          </button>
        </div>
        <span className="text-[13px] leading-5 text-ink-5">Same pipeline as a recording, minus transcription: handout, coverage against the syllabus, commitments and actions.</span>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          rows={12}
          placeholder="Okay so today we are staying with transactions…"
          className="w-full resize-y rounded-lg border border-line bg-soft px-3 py-2.5 text-[13px] leading-5 outline-none focus:border-ink-5"
        />
        <div className="flex flex-wrap items-center gap-2">
          {sample && (
            <button type="button" onClick={() => setText(sample.text)} className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-line px-2.5 text-xs font-bold text-ink hover:bg-soft" data-tip={`backend/app/data/lectures/${sample.file}`}>
              <Icon name="dataset" size={15} />
              Use the synthetic {paste.courseCode} transcript
            </button>
          )}
          <span className="text-xs text-ink-4">{words} words</span>
          <button type="button" onClick={close} className="ml-auto h-8 cursor-pointer rounded-md border border-line px-3.5 text-[13px] font-bold text-ink hover:bg-soft">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!text.trim()} className="h-8 cursor-pointer rounded-md bg-ink px-3.5 text-[13px] font-bold text-white disabled:cursor-default disabled:bg-ink-4">
            Process transcript
          </button>
        </div>
      </div>
    </>
  )
}
