import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { closeNote, elapsedSec, setMarkerNote, stopRecording, tapStuck } from '@/store/companion'
import { mmss } from '@/lib/time'
import { useWS } from '@/store/workspace'

const Kbd = ({ k, dark }: { k: string; dark?: boolean }) => (
  <kbd className={dark ? 'rounded border border-white/25 px-1 font-mono text-[10px] font-bold text-white/70' : 'rounded border border-line bg-white px-1 font-mono text-[10px] font-bold text-ink-5'}>{k}</kbd>
)

/** The composer while a lecture records: a live status strip, one big "I'm stuck", Stop, an optional note per tap. */
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
    <div className="flex-none px-5 pb-5">
      <div className="overflow-hidden rounded-lg border border-bad/50 bg-white shadow-[0_0_0_3px_rgba(239,68,68,.08),0_6px_20px_rgba(15,23,42,.06)]">
        <div className="flex items-center gap-2.5 border-b border-bad/15 bg-bad-soft px-3.5 py-2">
          {recording ? <span className="size-2.5 flex-none animate-rec rounded-full bg-bad" /> : <Spinner size={11} className="text-bad" />}
          <span className="text-[11px] font-black tracking-[.1em] text-bad">{recording ? 'REC' : r.status === 'starting' ? 'STARTING' : 'SAVING'}</span>
          <b className="font-mono text-[15px] tabular-nums">{mmss(elapsedSec())}</b>
          <span className="min-w-0 truncate text-[13px] text-ink-5">
            {r.status === 'starting' ? 'Waiting for the microphone…' : r.status === 'stopping' ? 'Saving the recording…' : `${r.courseCode}${course ? ` · ${course.title}` : ''}`}
          </span>
          <span className="ml-auto hidden flex-none text-[11px] text-ink-5 md:inline">Handout, coverage and actions follow when you stop</span>
        </div>
        <div className="flex gap-2 p-2">
          <button
            type="button"
            onClick={tapStuck}
            disabled={!recording}
            className="flex h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-md bg-ink text-base font-black text-white transition select-none hover:bg-ink-7 active:scale-[.99] disabled:cursor-wait disabled:opacity-60"
          >
            <Icon name="flag" size={20} fill className="text-bad" />
            I’m stuck
            {flags.length > 0 && <span className="rounded-full bg-white/15 px-2 py-px text-xs font-black tabular-nums">{flags.length}</span>}
            <span className="hidden sm:inline">
              <Kbd k="S" dark />
            </span>
          </button>
          <button
            type="button"
            onClick={() => void stopRecording()}
            disabled={!recording}
            className="flex h-12 flex-none cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-4 text-[13px] font-bold text-ink transition-colors hover:border-ink-3 hover:bg-soft disabled:cursor-wait disabled:opacity-50"
          >
            <span className="size-3 rounded-[3px] bg-bad" />
            Stop
            <span className="hidden sm:inline">
              <Kbd k="Esc" />
            </span>
          </button>
        </div>
        {noteFor && (
          <form
            className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-line bg-soft py-1 pr-2 pl-2.5 focus-within:border-ink-5"
            onSubmit={(e) => {
              e.preventDefault()
              setMarkerNote(noteFor.localId, note)
            }}
          >
            <span className="flex flex-none items-center gap-1 font-mono text-xs font-bold text-bad">
              <Icon name="flag" size={14} fill />
              {mmss(noteFor.atSec)}
            </span>
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
              placeholder="What lost you? Optional, e.g. “the 2PL diagram”"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-4"
            />
            <span className="flex-none text-[11px] text-ink-4 tabular-nums">{60 - note.length}</span>
            <span className="hidden flex-none text-[11px] text-ink-4 sm:inline">
              <Kbd k="Enter" /> save
            </span>
          </form>
        )}
        {flags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3.5 py-2 text-xs text-ink-5">
            {flags.map((m) => (
              <span key={m.localId} className="inline-flex h-[22px] max-w-[260px] items-center gap-1 rounded-md border border-bad/25 bg-bad-soft px-1.5 text-ink">
                <Icon name="flag" size={13} fill className="text-bad" />
                <b className="font-mono tabular-nums">{mmss(m.atSec)}</b>
                {m.note && <span className="truncate text-ink-5">“{m.note}”</span>}
              </span>
            ))}
            <span className="text-ink-4">Saved with the recording when you stop</span>
          </div>
        )}
      </div>
    </div>
  )
}
