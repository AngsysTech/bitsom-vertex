import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/** Material Symbols Rounded glyph. */
export function Icon({
  name,
  size = 18,
  fill,
  className,
  style,
}: {
  name: string
  size?: number
  fill?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span aria-hidden className={cn('icon', fill && 'icon-fill', className)} style={{ fontSize: size, width: size, ...style }}>
      {name}
    </span>
  )
}
