import { cn } from '@/lib/utils'

/** Small inline spinner for "in progress" rows (never a silent wait). */
export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block flex-none animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      style={{ width: size, height: size }}
    />
  )
}
