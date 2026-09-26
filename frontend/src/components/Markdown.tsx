import type { ReactNode } from 'react'
import type { Citation } from '@/types'
import { CitePill } from './CitePill'

// Minimal markdown for agent messages: paragraphs, "- " / "1. " lists, **bold**, *italic*, `code`, and [C1] citations.
const INLINE = /(\*\*[^*]+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`|\[C\d+\])/g

function inline(text: string, cites: Map<string, Citation>, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const k = `${key}.${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-mist px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      // Citations are verified server-side; an id with no matching citation is dropped, never invented.
      const c = cites.get(tok.slice(1, -1))
      if (c) out.push(<CitePill key={k} citation={c} />)
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, citations = [], className }: { text: string; citations?: Citation[]; className?: string }) {
  const cites = new Map(citations.map((c) => [c.id, c]))
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: ReactNode[] } | null = null
  const flush = (k: string) => {
    if (!list) return
    blocks.push(
      list.ordered ? (
        <ol key={k} className="mt-1 mb-0.5 list-decimal pl-[22px]">{list.items}</ol>
      ) : (
        <ul key={k} className="mt-1 mb-0.5 list-disc pl-[22px]">{list.items}</ul>
      ),
    )
    list = null
  }
  String(text || '')
    .split('\n')
    .forEach((line, i) => {
      const bullet = /^\s*[-•] (.*)$/.exec(line)
      const num = /^\s*\d+[.)] (.*)$/.exec(line)
      const item = bullet ?? num
      if (item) {
        const ordered = !bullet
        if (list && list.ordered !== ordered) flush(`l${i}`)
        list ??= { ordered, items: [] }
        list.items.push(<li key={i} className="my-0.5">{inline(item[1]!, cites, `i${i}`)}</li>)
        return
      }
      flush(`l${i}`)
      if (line.trim()) blocks.push(<p key={i} className="mb-1 last:mb-0">{inline(line, cites, `p${i}`)}</p>)
    })
  flush('end')
  return <div className={className}>{blocks}</div>
}
