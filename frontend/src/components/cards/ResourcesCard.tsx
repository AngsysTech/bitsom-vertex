import { CitePills } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import type { Citation, Resource, ResourcesCard as ResourcesCardT } from '@/types'
import { CardLabel, CardShell } from './shared'

const ICON: Record<Resource['kind'], string> = {
  ta_hours: 'school',
  faculty: 'person',
  library: 'local_library',
  tutoring: 'groups',
  lab: 'science',
}

export function ResourcesCard({ card, citations }: { card: ResourcesCardT; citations: Citation[] }) {
  return (
    <CardShell className="gap-0.5">
      <CardLabel className="mb-1.5">Resources</CardLabel>
      {card.items.map((r) => (
        <div key={`${r.kind}:${r.name}`} className="flex items-start gap-2.5 border-t border-line py-2">
          <Icon name={ICON[r.kind] ?? 'bookmark'} size={18} className="text-ink-5" style={{ lineHeight: '20px' }} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] leading-[19px]">
            <b>{r.name}</b>
            <span className="text-xs text-ink-5">{[r.forCourse, r.when, r.where].filter(Boolean).join(' · ')}</span>
          </div>
          <CitePills ids={[r.citationId]} citations={citations} />
        </div>
      ))}
    </CardShell>
  )
}
