import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionChip } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { HandoutViewToggle, LectureMindMap, type HandoutPaneView } from '@/components/LectureMindMap'
import { MakeRelevantButton, RelevantSlot } from '@/components/relevant/MakeRelevant'
import { Spinner } from '@/components/Spinner'
import { StudySourceRow } from '@/components/StudySources'
import { API_URL } from '@/lib/config'
import { classPath, navigate } from '@/lib/route'
import { fmtDayShort, mmss } from '@/lib/time'
import { cn } from '@/lib/utils'
import { addLateMarker } from '@/store/companion'
import { isLectureGone, useWS } from '@/store/workspace'
import type { Handout, HandoutSection, Lecture, TranscriptSegment } from '@/types'

const audioSrc = (url: string) => (/^(blob:|https?:)/.test(url) ? url : `${API_URL}${url}`)

interface Pin {
  key: string
  atSec: number
  note?: string
  pending: boolean
}

/** 0:00 → end, with section bands and flag pins. Click anywhere to flag that moment after the fact. */
function Timeline({ lecture, handout, segments, pins, onSeek }: { lecture: Lecture; handout: Handout; segments: TranscriptSegment[]; pins: Pin[]; onSeek: (sec: number) => void }) {
  const duration = lecture.durationSec || segments.at(-1)?.endSec || 0
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ atSec: number; note: string } | null>(null)
  const seg = new Map(segments.map((s) => [s.id, s]))
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }
  if (!duration) return null
  const pct = (sec: number) => `${(sec / duration) * 100}%`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-ink-5">
        <span className="font-bold tracking-[.06em] uppercase">Timeline · click to flag a moment</span>
        <span>{pins.length ? `🚩 ${pins.length} flag${pins.length > 1 ? 's' : ''}` : 'no flags yet'}</span>
      </div>
      <div
        ref={bar}
        onMouseMove={(e) => setHover(at(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setDraft({ atSec: Math.round(at(e.clientX)), note: '' })}
        className="relative h-9 cursor-crosshair rounded-md border border-line bg-soft"
      >
        {handout.sections.map((s, i) => {
          const first = seg.get(s.segmentIds[0] ?? '')
          const last = seg.get(s.segmentIds.at(-1) ?? '')
          if (!first || !last) return null
          return (
            <div
              key={s.id}
              data-tip={s.heading}
              className={cn('absolute top-1 bottom-1 rounded-[3px]', s.stuck ? 'bg-bad/25' : i % 2 ? 'bg-ink-3/60' : 'bg-ink-3/35')}
              style={{ left: pct(first.startSec), width: `calc(${pct(last.endSec - first.startSec)} - 2px)` }}
            />
          )
        })}
        {pins.map((p) => (
          <div key={p.key} className="absolute top-0 bottom-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(p.atSec) }} data-tip={`🚩 ${mmss(p.atSec)}${p.note ? ` — “${p.note}”` : ''}${p.pending ? ' (saving…)' : ''}`}>
            <span className={cn('h-full w-0.5', p.pending ? 'bg-warn' : 'bg-bad')} />
            <span className="absolute -top-2.5 text-xs">🚩</span>
          </div>
        ))}
        {hover != null && (
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink" style={{ left: pct(hover) }}>
            <span className="absolute -bottom-5 -translate-x-1/2 rounded bg-ink px-1 font-mono text-[10px] text-white">{mmss(hover)}</span>
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-ink-4">
        <span>0:00</span>
        <span>{mmss(duration / 2)}</span>
        <span>{mmss(duration)}</span>
      </div>
      {draft && (
        <form
          className="flex items-center gap-2 rounded-md border border-bad bg-bad-soft px-2.5 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            addLateMarker(lecture.id, lecture.courseCode, draft.atSec, draft.note)
            setDraft(null)
          }}
        >
          <span className="font-mono text-xs font-bold">🚩 {mmss(draft.atSec)}</span>
          <input
            autoFocus
            value={draft.note}
            maxLength={60}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setDraft(null))}
            placeholder="What lost you? (optional)"
            className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-2 text-[13px] outline-none"
          />
          <button type="button" onClick={() => onSeek(draft.atSec)} className="h-7 cursor-pointer rounded border border-line bg-white px-2 text-xs font-bold" data-tip="Listen from here">
            <Icon name="play_arrow" size={14} />
          </button>
          <button type="submit" className="h-7 cursor-pointer rounded bg-ink px-3 text-xs font-bold text-white">
            Flag
          </button>
          <button type="button" onClick={() => setDraft(null)} className="h-7 cursor-pointer px-1 text-xs font-bold text-ink-5">
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}

function SectionCard({ s, lecture, segments, focused, onSeg }: { s: HandoutSection; lecture: Lecture; segments: Map<string, TranscriptSegment>; focused: boolean; onSeg: (id: string) => void }) {
  const markers = useWS((st) => st.markers[lecture.id])
  const stuck = !!s.stuck?.markerIds.length
  const notes = (s.stuck?.markerIds ?? []).map((id, i) => ({ at: s.stuck!.atSec[i] ?? 0, note: markers?.find((m) => m.id === id)?.note }))
  const source = { type: 'handout_section' as const, lectureId: lecture.id, sectionId: s.id, ...(s.stuck?.markerIds[0] ? { markerId: s.stuck.markerIds[0] } : {}) }
  const segs = s.segmentIds.map((id) => segments.get(id)).filter((x): x is TranscriptSegment => !!x)
  return (
    <section
      id={`hs-${s.id}`}
      className={cn('flex flex-col gap-2.5 rounded-lg border border-line bg-white px-5 py-4', stuck && 'border-l-4 border-l-bad', focused && 'ring-2 ring-cyan')}
    >
      <div className="flex flex-wrap items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[17px] leading-6 font-black">{s.heading}</h3>
        {s.syllabusSectionId && <SectionChip sectionId={s.syllabusSectionId} className="mt-1" />}
      </div>
      {stuck && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-bad-soft px-3 py-2 text-[13px]">
          <b>🚩 You flagged this</b>
          {notes.map((n, i) => (
            <span key={i} className="text-ink-5">
              at <b className="font-mono text-ink">{mmss(n.at)}</b>
              {n.note && ` — “${n.note}”`}
            </span>
          ))}
          <MakeRelevantButton source={source} variant="prominent" className="ml-auto" />
        </div>
      )}
      {s.keyPoints.length > 0 && (
        <ul className="list-disc pl-5 text-[15px] leading-[23px]">
          {s.keyPoints.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      {s.definitions.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-soft px-3 py-2 text-[13px] leading-5">
          {s.definitions.map((d) => (
            <span key={d.term}>
              <b>{d.term}</b> — {d.definition}
            </span>
          ))}
        </div>
      )}
      {s.examples.length > 0 && (
        <div className="flex flex-col gap-1 text-[13px] leading-5">
          {s.examples.map((e) => (
            <span key={e} className="flex gap-1.5">
              <Icon name="lightbulb" size={15} className="mt-0.5 text-warn" />
              {e}
            </span>
          ))}
        </div>
      )}
      {s.examHints.map((h) => (
        <div key={h} className="flex items-start gap-2 rounded-md border border-cyan bg-cyan-soft px-3 py-2 text-[13px] leading-5">
          <Icon name="campaign" size={16} className="mt-0.5 text-ink" />
          <span>
            <b>Exam hint · </b>“{h}”
          </span>
        </div>
      ))}
      {s.studyFrom && <StudySourceRow src={s.studyFrom} className="rounded-md border border-line bg-mist px-3 py-2" />}
      <div className="flex flex-wrap items-center gap-1.5">
        {segs.slice(0, 6).map((x) => (
          <button key={x.id} type="button" onClick={() => onSeg(x.id)} data-tip={x.text.slice(0, 140) + (x.text.length > 140 ? '…' : '')} className="h-[22px] cursor-pointer rounded-full border border-line bg-soft px-2 font-mono text-[11px] font-bold hover:border-ink-5">
            ▸ {mmss(x.startSec)}
          </button>
        ))}
        {segs.length > 6 && <span className="text-xs text-ink-4">+{segs.length - 6}</span>}
        {!segs.length && s.segmentIds.length > 0 && <span className="text-xs text-ink-4">{s.segmentIds.join(', ')}</span>}
        {!stuck && <MakeRelevantButton source={source} className="ml-auto" />}
      </div>
      <RelevantSlot source={source} />
    </section>
  )
}

/** A lecture's handout, full width: summary, timeline, sections (stuck ones flagged), transcript. */
export function HandoutView({ courseCode, lectureId, focus }: { courseCode: string; lectureId: string; focus: string | null }) {
  const lecture = useWS((s) => s.lectures.value?.find((l) => l.id === lectureId) ?? Object.values(s.jobs).find((j) => j.lecture?.id === lectureId)?.lecture)
  const handout = useWS((s) => s.handouts[lectureId])
  const transcript = useWS((s) => s.transcripts[lectureId])
  const markers = useWS((s) => s.markers[lectureId])
  const local = useWS((s) => s.localMarkers)
  const loadHandout = useWS((s) => s.loadHandout)
  const loadTranscript = useWS((s) => s.loadTranscript)
  const loadMarkers = useWS((s) => s.loadMarkers)
  const [showTranscript, setShowTranscript] = useState(false)
  const [view, setView] = useState<HandoutPaneView>('handout')
  const audio = useRef<HTMLAudioElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadHandout(lectureId, true)
    void loadTranscript(lectureId)
    void loadMarkers(lectureId)
  }, [lectureId, loadHandout, loadTranscript, loadMarkers])

  const segments = useMemo(() => transcript?.value?.segments ?? [], [transcript])
  const segMap = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments])
  const h = handout?.value
  const focusSection = h?.sections.find((s) => s.id === focus) ?? (focus ? h?.sections.find((s) => s.segmentIds.includes(focus)) : undefined)
  const focusSegment = focus && segMap.has(focus) ? focus : null

  useEffect(() => {
    if (focusSegment) setShowTranscript(true)
  }, [focusSegment])
  useEffect(() => {
    if (!h) return
    const el = focusSegment ? document.getElementById(`seg-${focusSegment}`) : focusSection ? document.getElementById(`hs-${focusSection.id}`) : null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [h, focusSection, focusSegment, showTranscript])

  const seek = (sec: number) => {
    const a = audio.current
    if (!a) return
    a.currentTime = sec
    void a.play().catch(() => {})
  }
  const onSeg = (id: string) => {
    navigate(classPath(courseCode, 'lectures', lectureId, id))
    const s = segMap.get(id)
    if (s) seek(s.startSec)
  }

  const pins: Pin[] = [
    ...(markers ?? []).map((m) => ({ key: m.id, atSec: m.atSec, note: m.note, pending: false })),
    ...local.filter((m) => m.lectureId === lectureId && m.state !== 'posted').map((m) => ({ key: m.localId, atSec: m.atSec, note: m.note, pending: true })),
  ]

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-5">
      <div className="flex max-w-[880px] flex-col gap-4">
        <button type="button" onClick={() => navigate(classPath(courseCode, 'lectures'))} className="flex cursor-pointer items-center gap-1 self-start text-xs font-bold text-link">
          <Icon name="arrow_back" size={15} /> All lectures
        </button>
        {!h ? (
          handout?.status === 'error' && isLectureGone(handout.error) ? (
            <span className="flex items-center gap-2 text-sm text-ink-5">
              <Icon name="error" size={16} className="text-bad" /> This lecture no longer exists: a demo reset removed it.
            </span>
          ) : handout?.status === 'error' ? (
            <span className="flex items-center gap-2 text-sm text-ink-5">
              <Icon name="error" size={16} className="text-bad" /> Couldn’t load the handout: {handout.error} —
              <button type="button" onClick={() => void loadHandout(lectureId)} className="cursor-pointer font-bold text-link">
                try again
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-ink-5">
              <Spinner size={13} /> Loading the handout…
            </span>
          )
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold tracking-[.06em] text-ink-5 uppercase">
                  {courseCode} · Handout{lecture ? ` · ${fmtDayShort(lecture.date)}` : ''}
                  {lecture?.durationSec ? ` · ${mmss(lecture.durationSec)}` : ''}
                </span>
                <h2 className="text-2xl leading-8 font-black">{h.title}</h2>
              </div>
              <HandoutViewToggle value={view} onChange={setView} />
            </div>
            {view === 'mindmap' && (
              <LectureMindMap
                lectureId={lectureId}
                onOpenSection={(id) => {
                  setView('handout')
                  navigate(classPath(courseCode, 'lectures', lectureId, id))
                  requestAnimationFrame(() => document.getElementById(`hs-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
                }}
                className="h-[min(72vh,760px)] overflow-hidden rounded-lg border border-line"
              />
            )}
            <div className={cn('flex flex-col gap-4', view === 'mindmap' && 'hidden')}>
              {lecture?.audioUrl && <audio ref={audio} controls preload="none" src={audioSrc(lecture.audioUrl)} className="h-9 w-full max-w-[520px]" />}
              <p className="rounded-lg bg-soft px-4 py-3 text-[15px] leading-6 text-pretty">{h.summary}</p>
              {lecture && <Timeline lecture={lecture} handout={h} segments={segments} pins={pins} onSeek={seek} />}
              {h.sections.map((s) => (
                <SectionCard key={s.id} s={s} lecture={lecture ?? ({ id: lectureId, courseCode } as Lecture)} segments={segMap} focused={focusSection?.id === s.id} onSeg={onSeg} />
              ))}
              <div className="flex flex-col gap-2 rounded-lg border border-line">
                <button type="button" onClick={() => setShowTranscript(!showTranscript)} className="flex cursor-pointer items-center gap-2 px-4 py-3 text-left text-[13px] font-bold">
                  <Icon name={showTranscript ? 'expand_less' : 'expand_more'} size={18} />
                  Transcript · {segments.length} segments
                  {transcript?.status === 'loading' && <Spinner size={11} />}
                </button>
                {showTranscript && (
                  <div className="flex flex-col px-2 pb-2">
                    {segments.map((s) => (
                      <div key={s.id} id={`seg-${s.id}`} className={cn('flex gap-3 rounded-md px-2 py-1.5 text-[13px] leading-5', s.id === focusSegment && 'animate-flash bg-cyan-soft')}>
                        <button type="button" onClick={() => onSeg(s.id)} className="w-12 flex-none cursor-pointer text-right font-mono text-[11px] font-bold text-link">
                          {mmss(s.startSec)}
                        </button>
                        <span className="text-ink">{s.text}</span>
                      </div>
                    ))}
                    {transcript?.status === 'error' && <span className="px-2 text-xs text-bad">Couldn’t load the transcript: {transcript.error}</span>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
