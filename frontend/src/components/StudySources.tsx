import { SectionChip } from '@/components/CitePill'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import type { StudySource } from '@/types'

/** One place to study a topic (contracts v3.13). University = the syllabus reading list, cited to its section;
 *  web = suggested by the model and kept only because its link loaded live, so it is labelled AI-suggested. */
export function StudySourceRow({ src, className }: { src: StudySource; className?: string }) {
  const uni = src.kind === 'university'
  const [book, detail] = uni ? splitReading(src.title) : [src.title, undefined]
  return (
    <div className={cn('flex items-start gap-2 text-[13px] leading-5', className)}>
      <Icon name={uni ? 'menu_book' : 'public'} size={16} className={cn('mt-0.5 flex-none', uni ? 'text-ink' : 'text-link')} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-bold tracking-[.08em] text-ink-5 uppercase">
          {uni ? 'Study from · university reading list' : 'Study online · AI-suggested, link checked'}
        </span>
        {uni ? (
          <span>
            <b>{book}</b>
            {detail && <span className="text-ink-5"> — {detail}</span>}
            {src.citationId && <SectionChip sectionId={src.citationId} />}
          </span>
        ) : (
          <span>
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="font-bold text-link hover:underline">
              {src.title}
              <Icon name="open_in_new" size={13} className="ml-0.5 align-[-2px]" />
            </a>
            {src.publisher && <span className="text-ink-5"> · {src.publisher}</span>}
            {src.why && <span className="block text-xs text-ink-5">{src.why}</span>}
          </span>
        )}
      </div>
    </div>
  )
}

/** "Book, Ch. 18 Title — what to read" → ["Book, Ch. 18 Title", "what to read"]. */
function splitReading(title: string): [string, string | undefined] {
  const at = title.indexOf(' — ')
  return at < 0 ? [title.replace(/\.$/, ''), undefined] : [title.slice(0, at), title.slice(at + 3).replace(/\.$/, '')]
}

/** Where to study a Make it Relevant concept: the university reading, then the AI-suggested page (or why there is none). */
export function StudySources({ sources, note, className }: { sources?: StudySource[]; note?: string; className?: string }) {
  const hasWeb = !!sources?.some((s) => s.kind === 'web')
  if (!sources?.length && !note) return null
  return (
    <div className={cn('flex flex-col gap-2 rounded-md border border-line px-3 py-2.5', className)}>
      {(sources ?? []).map((s) => (
        <StudySourceRow key={`${s.kind}:${s.url ?? s.title}`} src={s} />
      ))}
      {note && !hasWeb && (
        <span data-tip={note} className="flex items-center gap-1.5 text-[11px] text-ink-5">
          <Icon name="link_off" size={14} />
          No online source: {note.replace(/\s*\(.*$/, '')}.
        </span>
      )}
    </div>
  )
}
