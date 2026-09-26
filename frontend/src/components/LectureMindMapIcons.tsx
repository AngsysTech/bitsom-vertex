// The seven lucide-react icon names the vendored mind map imports (src/vendored/mindmap/,
// jury-approved prior code), drawn with this app's Material Symbols. lucide-react is not a
// dependency here, so the vendored import points at this module. Built 26 Sep 2026.
import { Icon } from './Icon'

type Props = { className?: string; strokeWidth?: number }

function glyph(name: string, size: number) {
  return function MaterialGlyph({ className }: Props) {
    return <Icon name={name} size={size} className={className} />
  }
}

export const ChevronLeft = glyph('chevron_left', 12)
export const ChevronsDownUp = glyph('unfold_less', 18)
export const ChevronsUpDown = glyph('unfold_more', 18)
export const Minus = glyph('remove', 18)
export const Plus = glyph('add', 18)
export const Scan = glyph('fit_screen', 18)
export const Sparkles = glyph('auto_awesome', 12)
