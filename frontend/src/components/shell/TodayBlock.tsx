import { Icon } from '@/components/Icon'
import { Spinner } from '@/components/Spinner'
import { useCalendarRange } from '@/hooks/useCalendar'
import { DEFAULT_AGENT } from '@/lib/config'
import { classPath, navigate } from '@/lib/route'
import { addDays, daysUntil, fmtDow, fmtHM, minutesBetween, parseISO, startOfDay } from '@/lib/time'
import { useWS } from '@/store/workspace'

/** "cs-f212-dbms" → "DBMS"; channels without a suffix fall back to the course title. */
export function shortName(channelName: string | undefined, courseCode: string, title: string) {
  const slug = courseCode.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const suffix = channelName?.startsWith(`${slug}-`) ? channelName.slice(slug.length + 1) : ''
  if (!suffix) return title
  return suffix.length <= 4 ? suffix.toUpperCase() : suffix[0]!.toUpperCase() + suffix.slice(1)
}

const time = (iso: string) => (daysUntil(iso) === 0 ? fmtHM(iso) : `${fmtDow(iso)} ${fmtHM(iso)}`)

function Row({ when, children, onClick, tip }: { when: string; children: React.ReactNode; onClick: () => void; tip?: string }) {
  return (
    <div onClick={onClick} data-tip={tip} className="mx-2 flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 text-ink-3 hover:bg-ink-7">
      <span className="w-[62px] flex-none text-right font-mono text-[11px] text-ink-4">{when}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}

/** Sidebar TODAY: next class (/classes), next study block (/calendar), weekly review when one is ready. */
export function TodayBlock() {
  const classes = useWS((s) => s.classes)
  const channels = useWS((s) => s.channels)
  const one = useWS((s) => s.oneOnOne?.value)
  const set = useWS((s) => s.set)
  const today = startOfDay(new Date())
  const entry = useCalendarRange(today, addDays(today, 6))
  const now = new Date()
  const next = classes.filter((c) => c.nextSessionAt).sort((a, b) => a.nextSessionAt!.localeCompare(b.nextSessionAt!))[0]
  const study = (entry?.items ?? [])
    .filter((i) => (i.kind === 'study_block' || i.kind === 'prep' || i.kind === 'action') && i.end && parseISO(i.end) > now && i.status !== 'done')
    .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime())[0]
  const review = one && one.status === 'ready' && one.recap.blocksPlanned > 0
  return (
    <div className="flex flex-col">
      {next && (
        <Row when={time(next.nextSessionAt!)} onClick={() => navigate(classPath(next.courseCode))} tip={`${next.faculty} · Slot ${next.slot}`}>
          <b className="font-bold text-white">{next.courseCode}</b> · {shortName(channels.find((c) => c.courseCode === next.courseCode)?.name, next.courseCode, next.title)}
          {next.nextSessionRoom && ` · ${next.nextSessionRoom}`}
        </Row>
      )}
      {study ? (
        <Row when={time(study.start)} onClick={() => navigate('/calendar')} tip={study.courseCode}>
          {study.title.replace(/^Study: /, 'Study · ')} · {minutesBetween(study.start, study.end!)} min
        </Row>
      ) : entry?.status === 'loading' ? (
        <div className="mx-2 flex h-7 items-center gap-2 px-2.5 text-xs text-ink-4">
          <Spinner size={11} /> Loading your week…
        </div>
      ) : (
        <div className="mx-2 flex h-7 items-center px-2.5 pl-[82px] text-xs text-ink-4">No study blocks planned</div>
      )}
      {review && (
        <div
          onClick={() => {
            set({ tab: 'canvas', canvas: 'one_on_one', rail: 'home' })
            navigate(`/dm/${DEFAULT_AGENT}`)
          }}
          className="mx-2 flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 font-bold text-white hover:bg-ink-7"
        >
          <span className="flex w-[62px] flex-none justify-end">
            <span className="size-2 rounded-full bg-cyan" />
          </span>
          Weekly review ready
          <Icon name="chevron_right" size={16} className="ml-auto text-ink-4" />
        </div>
      )}
    </div>
  )
}
