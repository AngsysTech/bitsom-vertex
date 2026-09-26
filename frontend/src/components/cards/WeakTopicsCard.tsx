import { useState } from 'react'
import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { MakeRelevantButton, RelevantSlot } from '@/components/relevant/MakeRelevant'
import type { Citation, WeakTopicsCard as WeakTopicsCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

const TOP = 5

/**
 * Weak topics ranked by impact (0–100: internal-marks gap × what the topic carried in past end-sems,
 * computed in code). `course` filters to one class channel.
 */
export function WeakTopicsCard({ card, citations, course }: { card: WeakTopicsCardT; citations: Citation[]; course?: string }) {
  const [all, setAll] = useState(false)
  const items = card.items.filter((t) => !course || t.course === course).sort((a, b) => b.impact - a.impact)
  const shown = all ? items : items.slice(0, TOP)
  return (
    <CardShell>
      <div className="flex items-baseline justify-between gap-2">
        <CardLabel>{course ? `Weak topics in ${course}` : 'Weak topics · by impact'}</CardLabel>
        <span className="text-[11px] text-ink-5">marks × past papers</span>
      </div>
      {!items.length && <span className="text-[13px] text-ink-5">Nothing weak here — every topic with past-paper weight is at or above your average.</span>}
      {shown.map((t) => (
        <div key={`${t.course}:${t.topic}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="min-w-0">
              {!course && <span className="text-ink-5">{t.course} · </span>}
              <b>{t.topic}</b>
              <CitePills ids={[t.citationId]} citations={citations} className="ml-1" />
            </span>
            <span className="flex flex-none items-center gap-1.5">
              <b data-tip="Your internal marks on this topic">{t.score}</b>
              <MakeRelevantButton source={{ type: 'weak_topic', course: t.course, topic: t.topic }} variant="icon" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-sm bg-line" data-tip={`Impact ${t.impact} of 100`}>
              <div className="h-full bg-ink" style={{ width: `${Math.max(3, Math.min(100, t.impact))}%` }} />
            </div>
            <span className="flex-none text-[11px] text-ink-5">
              impact <b className="text-ink">{t.impact}</b> · ≈{Math.round(t.examWeight)} marks/paper
            </span>
          </div>
          {!!t.gaps?.length && (
            <div className="flex flex-col gap-0.5 rounded-md border border-warn bg-warn-soft px-2 py-1">
              <span className="flex items-center gap-1 text-[10px] font-bold tracking-[.06em] text-warn-ink uppercase" data-tip="Graded mid-sem answers from the exam system (synthetic connector)">
                <Icon name="warning" size={12} /> Smart Exam · where the marks went
              </span>
              {t.gaps.map((g) => (
                <span key={g.tag} className="text-xs leading-[16px] text-ink">
                  <b>−{g.marksLost}</b> {g.evidence}
                </span>
              ))}
            </div>
          )}
          <RelevantSlot source={{ type: 'weak_topic', course: t.course, topic: t.topic }} className="mt-1" />
        </div>
      ))}
      {items.length > TOP && (
        <button type="button" onClick={() => setAll(!all)} className="cursor-pointer self-start text-xs font-bold text-link">
          {all ? 'Show top 5' : `Show all ${items.length}`}
        </button>
      )}
    </CardShell>
  )
}
