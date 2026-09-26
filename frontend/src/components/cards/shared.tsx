import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function CardShell({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('flex flex-col gap-2.5 rounded-lg border border-line bg-soft px-4 py-3.5', className)}>{children}</section>
}

export function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase', className)}>{children}</span>
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2 flex-none rounded-full', className)} style={{ background: color }} />
}
