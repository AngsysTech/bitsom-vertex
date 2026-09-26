import type { PlacedCard } from '@/lib/cards'
import { AuditCard } from './AuditCard'
import { CoursesCard } from './CoursesCard'
import { PicksCard } from './PicksCard'
import { RelevantCard } from './RelevantCard'
import { ResourcesCard } from './ResourcesCard'
import { SkillsGapCard } from './SkillsGapCard'
import { StudyPlanCard } from './StudyPlanCard'
import { WeakTopicsCard } from './WeakTopicsCard'

export const EMPTY_CONTEXT = 'Context from this conversation appears here — audits, plans, courses and sources.'

function CardView({ placed: { card, citations } }: { placed: PlacedCard }) {
  switch (card.type) {
    case 'audit':
      return <AuditCard card={card} citations={citations} />
    case 'weak_topics':
      return <WeakTopicsCard card={card} citations={citations} />
    case 'study_plan':
      return <StudyPlanCard card={card} citations={citations} />
    case 'relevant':
      return <RelevantCard card={card} citations={citations} />
    case 'courses':
      return <CoursesCard card={card} citations={citations} />
    case 'skills_gap':
      return <SkillsGapCard card={card} citations={citations} />
    case 'picks':
      return <PicksCard card={card} citations={citations} />
    case 'resources':
      return <ResourcesCard card={card} citations={citations} />
    case 'one_on_one':
      return null // Study Buddy / Weekly 1:1 is held (AGENTS.md §4.5)
  }
}

/** Right-panel / canvas card stack. */
export function ContextCards({ cards, cols = '1fr', emptyText = EMPTY_CONTEXT }: { cards: PlacedCard[]; cols?: string; emptyText?: string | null }) {
  return (
    <div className="grid items-start gap-3 text-ink" style={{ gridTemplateColumns: cols }}>
      {cards.length === 0 && emptyText && <div className="px-2 py-6 text-center text-[13px] leading-5 text-ink-5">{emptyText}</div>}
      {cards.map((p) => (
        <CardView key={p.key} placed={p} />
      ))}
    </div>
  )
}
