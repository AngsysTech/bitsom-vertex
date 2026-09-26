import { useEffect } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { LECTURE_STATUS_LABEL } from '@/lib/labels'
import { classPath, navigate } from '@/lib/route'
import { fmtDayShort, mmss } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Lecture } from '@/types'

const PILL: Record<Lecture['status'], string> = {
  uploaded: 'border-line bg-white',
  transcribing: 'border-cyan bg-cyan-soft',
  transcribed: 'border-cyan bg-cyan-soft',
  processing: 'border-cyan bg-cyan-soft',
  ready: 'border-ok bg-ok-soft',
  failed: 'border-bad bg-bad-soft',
}

function LectureRow({ l }: { l: Lecture }) {
  const flags = useWS((s) => s.markers[l.id]?.length ?? s.handouts[l.id]?.value?.sections.reduce((n, x) => n + (x.stuck?.markerIds.length ?? 0), 0))
  const busy = l.status !== 'ready' && l.status !== 'failed'
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 hover:bg-soft">
      <span className="flex size-10 flex-none items-center justify-center rounded-lg bg-ink text-cyan">
        <Icon name={l.source === 'transcript' ? 'description' : l.source === 'upload' ? 'upload_file' : 'mic'} size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="truncate text-[15px]">{l.title ?? (busy ? 'Processing…' : 'Untitled lecture')}</b>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-5">
          {fmtDayShort(l.date)}
          {l.durationSec ? ` · ${mmss(l.durationSec)}` : ''} · {l.source}
          <span className={cn('flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-bold text-ink', PILL[l.status])}>
            {busy && <Spinner size={9} />}
            {LECTURE_STATUS_LABEL[l.status]}
          </span>
          {flags ? <span className="rounded-full border border-bad bg-bad-soft px-2 py-px text-[11px] font-bold text-ink">🚩 {flags}</span> : null}
        </span>
        {l.status === 'failed' && l.error && <span className="truncate text-xs text-bad">{l.error}</span>}
      </div>
      {l.status === 'ready' && (
        <button type="button" onClick={() => navigate(classPath(l.courseCode, 'lectures', l.id))} className="flex h-8 flex-none cursor-pointer items-center gap-1 rounded-md bg-ink px-3 text-[13px] font-bold text-white">
          Open handout
          <Icon name="arrow_forward" size={16} />
        </button>
      )}
    </div>
  )
}

/** This course's lectures (GET /students/:id/lectures, filtered). */
export function LecturesTab({ courseCode }: { courseCode: string }) {
  const entry = useWS((s) => s.lectures)
  const loadMarkers = useWS((s) => s.loadMarkers)
  const loadLectures = useWS((s) => s.loadLectures)
  const list = (entry.value ?? []).filter((l) => l.courseCode === courseCode)
  const ids = list.filter((l) => l.status === 'ready').map((l) => l.id).join(',')
  useEffect(() => {
    ids.split(',').filter(Boolean).forEach((id) => void loadMarkers(id))
  }, [ids, loadMarkers])
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="flex max-w-[860px] flex-col gap-2.5">
        {entry.status === 'loading' && !entry.value && (
          <span className="flex items-center gap-2 text-sm text-ink-5">
            <Spinner size={13} /> Loading lectures…
          </span>
        )}
        {entry.status === 'error' && (
          <span className="flex items-center gap-2 text-sm text-ink-5">
            <Icon name="error" size={16} className="text-bad" /> Couldn’t load lectures: {entry.error} —
            <button type="button" onClick={() => void loadLectures()} className="cursor-pointer font-bold text-link">
              try again
            </button>
          </span>
        )}
        {entry.value && !list.length && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line px-5 py-6 text-sm text-ink-5">
            <b className="text-ink">No lectures for {courseCode} yet</b>
            Record the next class from the Messages tab (or press <kbd className="rounded border border-line px-1 font-mono text-xs">R</kbd>), upload audio, or paste a transcript.
          </div>
        )}
        {list.map((l) => (
          <LectureRow key={l.id} l={l} />
        ))}
      </div>
    </div>
  )
}
