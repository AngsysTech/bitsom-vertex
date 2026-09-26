import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { DEFAULT_AGENT } from '@/lib/config'
import { dismissJob, retryJob, retryMarker } from '@/store/companion'
import { classPath, navigate } from '@/lib/route'
import { mmss } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useWS, type LectureJob, type LocalMarker } from '@/store/workspace'

type StepState = 'todo' | 'active' | 'done' | 'error'

/**
 * Steps flip with Lecture.status: transcribing → "Transcribing…", transcribed → "Building handout…",
 * processing → handout and coverage in progress, ready → all done. A failure marks the step it names.
 */
function steps(job: LectureJob): { label: string; state: StepState }[] {
  const st = job.lecture?.status
  const text = job.source === 'transcript'
  const failedAt = job.phase === 'failed' ? (/^(transcrib|stt|audio)/i.test(job.error ?? '') ? 1 : /^(handout|syllabus|notes)/i.test(job.error ?? '') ? 2 : 3) : -1
  const order = { uploaded: 1, transcribing: 1, transcribed: 2, processing: 3, ready: 4, failed: 0 } as const
  const reached = job.phase === 'uploading' || job.phase === 'upload_failed' ? 0 : st ? order[st] : 1
  const stateOf = (i: number, activeWhen: boolean): StepState => {
    if (failedAt === i) return 'error'
    if (failedAt >= 0) return i < failedAt ? 'done' : 'todo'
    if (reached >= 4) return 'done'
    if (i === 0) return job.phase === 'upload_failed' ? 'error' : job.phase === 'uploading' ? 'active' : 'done'
    if (activeWhen) return 'active'
    return i < reached ? 'done' : 'todo'
  }
  const names = [
    { todo: text ? 'Send transcript' : 'Upload audio', active: text ? 'Sending transcript…' : 'Uploading audio…', done: text ? 'Transcript received' : 'Audio uploaded', error: 'Upload failed' },
    { todo: text ? 'Segment transcript' : 'Transcribe', active: text ? 'Segmenting transcript…' : 'Transcribing…', done: text ? 'Transcript segmented' : 'Transcribed', error: 'Transcription failed' },
    { todo: 'Build handout', active: 'Building handout…', done: 'Handout built', error: 'Handout failed' },
    { todo: 'Check coverage', active: 'Checking coverage…', done: 'Coverage checked', error: 'Coverage check failed' },
  ]
  const states = [
    stateOf(0, false),
    stateOf(1, st === 'transcribing' || (st === 'uploaded' && job.phase === 'processing')),
    stateOf(2, st === 'transcribed' || st === 'processing'),
    stateOf(3, st === 'processing'),
  ]
  return names.map((n, i) => ({ label: n[states[i]!], state: states[i]! }))
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Icon name="check_circle" size={16} fill className="text-ok" />
  if (state === 'active') return <Spinner size={13} className="mx-px text-ink" />
  if (state === 'error') return <Icon name="error" size={16} fill className="text-bad" />
  return <Icon name="radio_button_unchecked" size={16} className="text-ink-4" />
}

/** "Checked 1s ago" — every poll is visible. */
function PollLine({ job }: { job: LectureJob }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (job.phase !== 'processing') return null
  if (job.pollError)
    return (
      <span className="flex items-center gap-1 text-xs text-warn-ink">
        <Icon name="wifi_off" size={14} /> Can’t reach the backend ({job.pollError}) — still retrying every 2 s
      </span>
    )
  const ago = job.lastPollAt ? Math.max(0, Math.round((Date.now() - job.lastPollAt) / 1000)) : null
  return <span className="text-xs text-ink-4">{ago == null ? 'Starting…' : `Checked ${ago}s ago · every 2 s`}</span>
}

/** One lecture going through the pipeline, live at the bottom of its class thread. */
export function JobRow({ job }: { job: LectureJob }) {
  const set = useWS((s) => s.set)
  const lec = job.lecture
  const icon = job.source === 'transcript' ? 'description' : job.source === 'upload' ? 'upload_file' : 'mic'
  const what = job.source === 'transcript' ? 'Pasted transcript' : job.source === 'upload' ? 'Uploaded audio' : 'Recorded lecture'
  const failed = job.phase === 'failed' || job.phase === 'upload_failed'
  return (
    <div data-msg-id={`job:${job.id}`} className="py-2 pr-5 pl-[66px]">
      <div className={cn('flex max-w-[560px] flex-col gap-1.5 rounded-lg border px-3.5 py-2.5', failed ? 'border-bad bg-bad-soft' : job.phase === 'ready' ? 'border-ok bg-ok-soft' : 'border-line bg-soft')}>
        <div className="flex items-center gap-2 text-[13px]">
          <Icon name={icon} size={17} className="text-ink-5" />
          <b>{what}</b>
          <span className="text-ink-5">
            · {job.courseCode}
            {lec?.durationSec ? ` · ${mmss(lec.durationSec)}` : ''}
          </span>
          {job.phase === 'ready' && (
            <button type="button" onClick={() => dismissJob(job.id)} aria-label="Dismiss" className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded text-ink-5 hover:bg-white">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {steps(job).map((s) => (
            <span key={s.label} className={cn('flex items-center gap-2 text-[13px]', s.state === 'todo' ? 'text-ink-4' : 'text-ink')}>
              <StepIcon state={s.state} />
              {s.label}
            </span>
          ))}
        </div>
        <PollLine job={job} />
        {failed && (
          <div className="flex flex-col gap-2 border-t border-bad/30 pt-2">
            <span className="text-[13px] text-ink">
              <b>{job.phase === 'upload_failed' ? 'Upload failed' : 'Processing failed'}:</b> {job.error}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => retryJob(job.id)} className="flex h-7 cursor-pointer items-center gap-1 rounded-md bg-ink px-3 text-xs font-bold text-white">
                <Icon name="refresh" size={15} />
                {job.phase === 'upload_failed' ? 'Retry upload' : 'Retry'}
              </button>
              <button type="button" onClick={() => set({ paste: { courseCode: job.courseCode } })} className="h-7 cursor-pointer rounded-md border border-ink bg-white px-3 text-xs font-bold text-ink">
                Use transcript instead
              </button>
            </div>
          </div>
        )}
        {job.phase === 'ready' && lec && (
          <div className="flex items-center gap-2 border-t border-ok/30 pt-2 text-[13px]">
            <b>Handout ready</b>
            <button type="button" onClick={() => navigate(classPath(job.courseCode, 'lectures', lec.id))} className="flex cursor-pointer items-center gap-0.5 font-bold text-link">
              Open handout <Icon name="arrow_outward" size={14} />
            </button>
            {!job.messageId && !job.messageWaitDone && (
              <span className="flex items-center gap-1 text-xs text-ink-5">
                <Spinner size={11} /> waiting for the coach’s message…
              </span>
            )}
            {job.dmMessageId && (
              <button type="button" onClick={() => (set({ scrollTo: job.dmMessageId! }), navigate(`/dm/${DEFAULT_AGENT}`))} className="cursor-pointer text-xs font-bold text-link">
                The coach’s summary is in your DM
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** "🚩 Flagged at 12:40 — 'lost at 2PL diagram'", with where its POST stands. */
export function MarkerRow({ m }: { m: LocalMarker }) {
  const state =
    m.state === 'posted' ? (
      <span className="flex items-center gap-0.5 text-ok">
        <Icon name="check" size={13} /> saved
      </span>
    ) : m.state === 'posting' ? (
      <span className="flex items-center gap-1">
        <Spinner size={10} /> sending…
      </span>
    ) : m.state === 'failed' ? (
      <span className="flex items-center gap-1 text-bad">
        not saved ({m.error}) —
        <button type="button" onClick={() => retryMarker(m.localId)} className="cursor-pointer font-bold text-link">
          retry
        </button>
      </span>
    ) : m.lectureId ? (
      <span className="text-warn-ink">{m.error ? `retrying (${m.error})` : 'queued'}</span>
    ) : (
      <span>queued · posts when the recording uploads</span>
    )
  return (
    <div className="flex items-center gap-2 py-1 pr-5 pl-[66px] text-[13px]">
      <span>🚩</span>
      <span>
        Flagged at <b className="font-mono">{mmss(m.atSec)}</b>
        {m.note && <span className="text-ink"> — “{m.note}”</span>}
      </span>
      <span className="text-xs text-ink-4">·</span>
      <span className="text-xs text-ink-5">{state}</span>
    </div>
  )
}
