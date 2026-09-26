import { useEffect, useState } from 'react'

/** One global tooltip for every element with a `data-tip` attribute (e.g. "Coming soon"). */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null
      const text = el?.dataset.tip
      if (!el || !text) return setTip((t) => (t ? null : t))
      const r = el.getBoundingClientRect()
      const x = Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170)
      setTip((t) => (t && t.text === text && t.x === x && t.y === r.bottom + 6 ? t : { text, x, y: r.bottom + 6 }))
    }
    const hide = () => setTip(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousedown', hide)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', hide)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1001] w-max max-w-[320px] -translate-x-1/2 rounded-md bg-ink px-[9px] py-[5px] text-xs leading-[17px] font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,.25)]"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
