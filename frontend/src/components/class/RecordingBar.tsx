import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { closeNote, elapsedSec, setMarkerNote, stopRecording, tapStuck } from '@/store/companion'
import { mmss } from '@/lib/time'
import { useWS } from '@/store/workspace'

/** The composer while a lecture records: elapsed time, a big "I'm stuck", an optional note per tap, Stop. */
export function RecordingBar() {
  const r = useWS((s) => s.recording)
  const course = useWS((s) => s.classes.find((c) => c.courseCode === s.recording?.courseCode))
  const allMarkers = useWS((s) => s.localMarkers)
  const [, tick] = useState(0)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    setNote('')
    if (r?.noteFor) noteRef.current?.focus({ preventScroll: true })
  }, [r?.noteFor])
  if (!r) return null
  const flags = allMarkers.filter((m) => m.courseCode === r.courseCode && !m.lectureId && Date.parse(m.createdAt) >= r.startedAt - 1000)
  const noteFor = flags.find((m) => m.localId === r.noteFor)
  const recording = r.status === 'recording'
  return (
    <div className="flex-none px-5 pb-[18px]">
      <div className="flex flex-col gap-2.5 rounded-lg border-2 border-bad bg-white px-4 py-3 shadow-[0_6px_20px_rgba(239,68,68,.12)]">
        <div className="flex items-center gap-3">
          {recording ? <span className="size-3 flex-none animate-rec rounded-full bg-bad" /> : <Spinner size={14} className="text-bad" />}
          <b className="font-mono text-xl tabular-nums">{mmss(elapsedSec())}</b>
          <span className="min-w-0 truncate text-[13px] text-ink-5">
            {r.status === 'starting' ? 'Waiting for the microphone…' : r.status === 'stopping' ? 'Saving the recording…' : `Recording ${r.courseCode}${course ? ` · ${course.title}` : ''}`}
          </span>
          <span className="ml-auto hidden text-[11px] text-ink-4 xl:inline">
            <kbd className="rounded border border-line px-1 font-mono">S</kbd> stuck · <kbd className="rounded border border-line px-1 font-mono">Esc</kbd> stop
          </span>
          <button
            type="button"
            onClick={() => void stopRecording()}
            disabled={!recording}
            className="flex h-9 flex-none cursor-pointer items-center gap-1.5 rounded-md border border-ink px-3.5 text-[13px] font-bold text-ink hover:bg-soft disabled:cursor-wait disabled:opacity-50"
          >
            <Icon name="stop" size={18} fill />
            Stop
          </button>
        </div>
        <button
          type="button"
          onClick={tapStuck}
          disabled={!recording}
          className="flex h-14 cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-black text-cyan select-none hover:bg-ink-7 active:scale-[.99] disabled:cursor-wait disabled:opacity-60"
        >
          <span className="text-xl">🚩</span>
          I’m stuck
          {flags.length > 0 && <span className="rounded-full bg-cyan px-2 text-xs font-black text-ink">{flags.length}</span>}
        </button>
        {noteFor && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setMarkerNote(noteFor.localId, note)
            }}
          >
            <span className="flex-none font-mono text-xs font-bold text-bad">🚩 {mmss(noteFor.atSec)}</span>
            <input
              ref={noteRef}
              value={note}
              maxLength={60}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  e.preventDefault()
                  closeNote()
                }
              }}
              placeholder="What lost you? e.g. “lost at 2PL diagram” — optional, Enter to save"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-soft px-2.5 text-[13px] outline-none focus:border-ink-5"
            />
            <span className="w-9 flex-none text-right text-[11px] text-ink-4">{60 - note.length}</span>
          </form>
        )}
        {flags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-5">
            <span>Flags:</span>
            {flags.map((m) => (
              <span key={m.localId} className="rounded-full border border-bad bg-bad-soft px-2 py-px font-bold text-ink">
                🚩 {mmss(m.atSec)}
                {m.note && <span className="font-normal"> “{m.note}”</span>}
              </span>
            ))}
            <span className="text-ink-4">· saved with the recording when you stop</span>
          </div>
        )}
      </div>
    </div>
  )
}
