import { useEffect } from 'react'
import { SectionChip } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { classPath, navigate } from '@/lib/route'
import { fmtDayShort, mmss } from '@/lib/time'
import { useWS } from '@/store/workspace'
import type { Citation, CoverageCard as CoverageCardT } from '@/types'
import { CardLabel, CardShell, Dot } from './shared'

const GREEN = '#10B981'
const AMBER = '#F59E0B'
const CYAN = '#22D3EE'

/** Segment id → "mm:ss" chip that opens the handout at that transcript segment. */
export function SegmentChip({ lectureId, courseCode, segmentId, atSec }: { lectureId: string; courseCode: string; segmentId?: string; atSec?: number }) {
  const start = useWS((s) => (segmentId ? s.transcripts[lectureId]?.value?.segments.find((x) => x.id === segmentId)?.startSec : undefined))
  const sec = atSec ?? start
  return (
    <button
      type="button"
      onClick={() => navigate(classPath(courseCode, 'lectures', lectureId, segmentId))}
      data-tip={segmentId ? `Transcript segment ${segmentId}` : 'Open the handout here'}
      className="inline-flex h-[18px] flex-none cursor-pointer items-center gap-0.5 rounded-full border border-line bg-white px-1.5 font-mono text-[10px] font-bold text-ink hover:border-ink-5"
    >
      <Icon name="play_arrow" size={11} fill />
      {sec != null ? mmss(sec) : (segmentId ?? '—')}
    </button>
  )
}

function Group({ color, icon, title, count, children }: { color: string; icon?: string; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-bold">
        {icon ? <Icon name={icon} size={14} fill style={{ color }} /> : <Dot color={color} />}
        {title} <span className="font-normal text-ink-5">{count}</span>
      </span>
      <div className="flex flex-col gap-1.5 pl-3.5">{children}</div>
    </div>
  )
}

/** What the lecture covered against its syllabus unit: covered, skipped, emphasized, and where you got lost. */
export function CoverageCard({ card }: { card: CoverageCardT; citations: Citation[] }) {
  const lecture = useWS((s) => s.lectures.value?.find((l) => l.id === card.lectureId) ?? Object.values(s.jobs).find((j) => j.lecture?.id === card.lectureId)?.lecture)
  const loadTranscript = useWS((s) => s.loadTranscript)
  useEffect(() => {
    if (card.emphasized.length) void loadTranscript(card.lectureId)
  }, [card.lectureId, card.emphasized.length, loadTranscript])
  const section = (id: string) => navigate(classPath(card.courseCode, 'lectures', card.lectureId, id))
  return (
    <CardShell>
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>Coverage{lecture ? ` · ${fmtDayShort(lecture.date)}` : ''}</CardLabel>
        <button type="button" onClick={() => navigate(classPath(card.courseCode, 'lectures', card.lectureId))} className="flex cursor-pointer items-center gap-0.5 text-xs font-bold text-link">
          Handout <Icon name="arrow_outward" size={13} />
        </button>
      </div>
      <b className="text-sm leading-[19px]">{card.unit || 'No syllabus unit matched'}</b>
      <Group color={GREEN} title="Covered" count={card.covered.length}>
        <div className="flex flex-wrap gap-1">
          {card.covered.map((c) => (
            <button
              key={c.topic}
              type="button"
              onClick={() => c.handoutSectionIds[0] && section(c.handoutSectionIds[0])}
              className="h-[22px] cursor-pointer rounded-full border border-ok bg-white px-2 text-xs hover:bg-ok-soft"
            >
              {c.topic}
            </button>
          ))}
        </div>
      </Group>
      <Group color={AMBER} title="Skipped" count={card.missed.length}>
        {card.missed.map((m) => (
          <div key={m.topic} className="flex flex-col gap-0.5 rounded-md border border-warn bg-warn-soft px-2.5 py-1.5 text-[13px] leading-[18px]">
            <span className="flex flex-wrap items-center gap-1">
              <b>{m.topic}</b>
              <SectionChip sectionId={m.syllabusSectionId} className="mx-0" />
            </span>
            <span className="text-xs text-ink-5">{m.why}</span>
          </div>
        ))}
      </Group>
      <Group color={CYAN} title="Emphasized" count={card.emphasized.length}>
        {card.emphasized.map((e) => (
          <div key={`${e.topic}:${e.segmentId}`} className="flex flex-col gap-1 text-[13px] leading-[18px]">
            <span className="flex items-center justify-between gap-2">
              <b>{e.topic}</b>
              <SegmentChip lectureId={card.lectureId} courseCode={card.courseCode} segmentId={e.segmentId} />
            </span>
            <span className="border-l-2 border-cyan pl-2 text-xs text-ink italic">“{e.quote}”</span>
          </div>
        ))}
      </Group>
      <Group color="#EF4444" icon="flag" title="Confusion" count={card.confusion?.length ?? 0}>
        {(card.confusion ?? []).map((c) => (
          <div key={c.markerId} className="flex items-center justify-between gap-2 text-[13px] leading-[18px]">
            <button type="button" onClick={() => section(c.handoutSectionId)} className="min-w-0 cursor-pointer text-left hover:underline">
              <b>{c.topic}</b>
              {c.note && <span className="text-ink-5"> · “{c.note}”</span>}
            </button>
            <SegmentChip lectureId={card.lectureId} courseCode={card.courseCode} atSec={c.atSec} segmentId={undefined} />
          </div>
        ))}
      </Group>
    </CardShell>
  )
}
