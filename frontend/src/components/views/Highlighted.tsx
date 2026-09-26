/** Text with the first occurrence of `quote` wrapped in a <mark>. */
export function Highlighted({ text, quote }: { text: string; quote?: string | null }) {
  const i = quote ? text.indexOf(quote) : -1
  if (!quote || i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-cyan-mark px-0.5 py-px text-inherit">{quote}</mark>
      {text.slice(i + quote.length)}
    </>
  )
}
