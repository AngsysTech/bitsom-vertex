import { CalendarView } from '@/components/calendar/CalendarView'
import { Composer } from '@/components/chat/Composer'
import { Messages, type ExtraRow } from '@/components/chat/Messages'
import { Icon } from '@/components/Icon'
import { classPath, navigate, type ClassTab } from '@/lib/route'
import { fmtDayShort, fmtHM, inDays } from '@/lib/time'
import { cn } from '@/lib/utils'
import { startRecording } from '@/store/companion'
import { classKey, useWS, type LocalMarker } from '@/store/workspace'
import type { Agent, ClassChannel as ClassChannelT } from '@/types'
import { AudioDropZone, UploadButton, useAudioPicker } from './AudioUpload'
import { HandoutView } from './HandoutView'
import { LecturesTab } from './LecturesTab'
import { JobRow, MarkerGroupRow } from './LectureRows'
import { RecordingBar } from './RecordingBar'

const COACH: Agent = { id: 'academic_coach', kind: 'specialist', name: 'Academic Coach', tagline: '', emoji: '🎓', scope: [], starters: [] }
const EXAM_LABEL = { quiz: 'Quiz', mid_sem: 'Mid-sem', end_sem: 'End-sem' } as const
const slugOf = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Slack's bookmarks, as the coach's scope: the documents this channel's coach reads. */
function ReadsLinks({ courseCode }: { courseCode: string }) {
  const files = useWS((s) => s.files)
  const doc = (kind: string, match?: (id: string, title: string) => boolean) =>
    files.find((f) => f.kind === 'document' && f.docKind === kind && (!match || match(f.id, f.title)))
  const syllabus = doc('syllabus', (id, title) => id === `syllabus.${slugOf(courseCode)}` || title.startsWith(courseCode))
  const papers = doc('past_papers')
  const exams = doc('exam_calendar')
  const links: { label: string; icon: string; go?: () => void }[] = [
    { label: 'Syllabus', icon: 'menu_book', go: syllabus && (() => navigate(`/files/${syllabus.id}`)) },
    { label: 'Past papers', icon: 'quiz', go: papers && (() => navigate(`/files/${papers.id}`)) },
    { label: 'Exam calendar', icon: 'event', go: exams && (() => navigate(`/files/${exams.id}/exam_calendar.${slugOf(courseCode)}`)) },
  ]
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <span data-tip="The coach in this channel answers only from these, plus the lectures" className="mr-1 hidden flex-none cursor-default text-xs text-ink-4 @3xl:inline">
        Coach reads
      </span>
      {links.map((c) => (
        <button
          key={c.label}
          type="button"
          disabled={!c.go}
          onClick={c.go}
          data-tip={c.go ? c.label : 'Not in this workspace’s files'}
          className="flex h-7 flex-none cursor-pointer items-center gap-1 rounded-md px-1.5 text-[13px] whitespace-nowrap text-ink-5 hover:bg-mist hover:text-ink disabled:cursor-default disabled:opacity-50"
        >
          <Icon name={c.icon} size={16} className="text-ink-4" />
          <span className="hidden @2xl:inline">{c.label}</span>
        </button>
      ))}
    </div>
  )
}

const Dot = () => <span className="text-ink-3">·</span>

function Header({ cls, tab }: { cls: ClassChannelT; tab: ClassTab }) {
  const starred = useWS((s) => s.starred.includes(cls.channelId))
  const panelOpen = useWS((s) => s.panelOpen)
  const set = useWS((s) => s.set)
  const lectures = useWS((s) => s.lectures.value?.filter((l) => l.courseCode === cls.courseCode).length ?? 0)
  const tabs: { id: ClassTab; label: string; icon: string; count?: number }[] = [
    { id: 'messages', label: 'Messages', icon: 'chat_bubble' },
    { id: 'lectures', label: 'Lectures', icon: 'mic', count: lectures },
    { id: 'schedule', label: 'Schedule', icon: 'calendar_month' },
  ]
  return (
    <div className="flex-none border-b border-line">
      <div className="flex items-center gap-3 px-5 pt-3 pb-1.5">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-mist text-lg">📘</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[17px] leading-6 font-black">
              {cls.courseCode} · {cls.title}
            </span>
            <button
              type="button"
              onClick={() => set((s) => ({ starred: starred ? s.starred.filter((x) => x !== cls.channelId) : [...s.starred, cls.channelId] }))}
              data-tip={starred ? 'Remove from Starred' : 'Star channel'}
              className={cn('flex size-6 flex-none cursor-pointer items-center justify-center rounded hover:bg-mist', starred ? 'text-warn' : 'text-ink-4 hover:text-ink')}
            >
              <Icon name="star" size={17} fill={starred} />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[13px] leading-5 whitespace-nowrap text-ink-5">
            <span className="truncate">
              {cls.faculty} · Slot {cls.slot}
            </span>
            {cls.nextSessionAt && (
              <>
                <Dot />
                <span className="flex flex-none items-center gap-1">
                  <Icon name="schedule" size={15} className="text-ink-4" />
                  Next {fmtDayShort(cls.nextSessionAt)} {fmtHM(cls.nextSessionAt)}
                  {cls.nextSessionRoom && ` · ${cls.nextSessionRoom}`}
                </span>
                {cls.prepDue > 0 && <span className="flex-none rounded-full bg-warn-soft px-1.5 text-[11px] leading-[18px] font-bold text-warn-ink">{cls.prepDue} prep due</span>}
              </>
            )}
            {cls.examAt && (
              <>
                <Dot />
                <span className="flex flex-none items-center gap-1 font-bold text-bad">
                  <Icon name="event" size={15} />
                  {EXAM_LABEL[cls.examKind ?? 'quiz']} {inDays(cls.examAt)}
                </span>
              </>
            )}
          </div>
        </div>
        {!panelOpen && (
          <button type="button" onClick={() => set({ panelOpen: true })} className="flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-bold text-ink hover:bg-soft">
            <Icon name="view_sidebar" size={18} />
            Context
          </button>
        )}
      </div>
      <div className="@container flex items-center gap-1 px-3.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(classPath(cls.courseCode, t.id))}
            className={cn(
              'flex flex-none cursor-pointer items-center gap-1.5 border-b-2 px-1.5 pt-1 pb-2 text-[13px] font-bold',
              tab === t.id ? 'border-ink text-ink' : 'border-transparent text-ink-5 hover:text-ink',
            )}
          >
            <Icon name={t.icon} size={16} fill={tab === t.id} />
            {t.label}
            {!!t.count && <span className="rounded-full bg-mist px-1.5 text-[11px] leading-4 text-ink-5">{t.count}</span>}
          </button>
        ))}
        <span className="mx-2 mb-1 h-4 w-px flex-none bg-line" />
        <div className="mb-1 min-w-0 flex-1">
          <ReadsLinks courseCode={cls.courseCode} />
        </div>
      </div>
    </div>
  )
}

/** Slack's mic slot in the composer toolbar, labelled: this is the channel's main action. */
function RecordButton({ courseCode, disabled }: { courseCode: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void startRecording(courseCode)}
      data-tip={disabled ? 'Another class is recording' : 'Record this class · R'}
      className="group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 pl-1 text-[13px] font-bold text-ink transition-colors hover:bg-bad-soft disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-bad text-white">
        <Icon name="mic" size={14} fill />
      </span>
      <span className="whitespace-nowrap">
        Record<span className="hidden @md:inline"> lecture</span>
      </span>
      <kbd className="rounded border border-line bg-white px-1 font-mono text-[10px] font-bold text-ink-5">R</kbd>
    </button>
  )
}

function ClassComposer({ courseCode }: { courseCode: string }) {
  const recording = useWS((s) => s.recording)
  const recordingError = useWS((s) => s.recordingError)
  const uploadError = useWS((s) => s.uploadError)
  const set = useWS((s) => s.set)
  const picker = useAudioPicker(courseCode)
  if (recording?.courseCode === courseCode) return <RecordingBar />
  const elsewhere = recording && recording.courseCode !== courseCode ? recording.courseCode : null
  const notice = recordingError ?? uploadError
  return (
    <>
      {(notice || elsewhere) && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-md border border-line bg-soft px-3 py-2 text-[13px] text-ink-5">
          <Icon name={elsewhere ? 'mic' : recordingError ? 'mic_off' : 'error'} size={16} className={elsewhere ? 'text-bad' : 'text-ink-4'} />
          {elsewhere ? (
            <>
              Recording in progress in {elsewhere} —
              <button type="button" onClick={() => navigate(classPath(elsewhere))} className="cursor-pointer font-bold text-link">
                go there
              </button>
            </>
          ) : (
            <>
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => set({ recordingError: null, uploadError: null })} className="cursor-pointer text-xs font-bold text-link">
                dismiss
              </button>
            </>
          )}
        </div>
      )}
      {picker.input}
      <Composer
        threadKey={classKey(courseCode)}
        placeholder={`Message Academic Coach about ${courseCode}`}
        tools={
          <>
            <RecordButton courseCode={courseCode} disabled={!!elsewhere} />
            <UploadButton onClick={picker.open} />
          </>
        }
        plus={[
          { icon: 'upload', label: 'Upload recording', hint: 'Audio or video you already have: mp3, m4a, wav, mp4, mov… (or drop the files here)', onClick: picker.open },
          { icon: 'description', label: 'Paste transcript', hint: 'Text fallback: same pipeline, no transcription', onClick: () => set({ paste: { courseCode } }) },
        ]}
      />
    </>
  )
}

function Empty({ channelName, courseCode }: { channelName: string; courseCode: string }) {
  return (
    <div className="flex max-w-[720px] flex-col gap-2 px-5 pt-6 pb-4">
      <span className="flex size-[64px] items-center justify-center rounded-[14px] border border-line bg-soft text-[32px]">📘</span>
      <span className="mt-1 text-[22px] font-black">This is the start of #{channelName}</span>
      <span className="text-[15px] leading-[22px] text-ink-5">
        The Academic Coach here reads only {courseCode}: its syllabus, lectures, past papers and exam dates. Record the next class and tap <b className="text-ink">I’m stuck</b> when you get lost, or upload a recording you already have (you can flag moments on its handout afterwards); the handout, coverage and actions land here.
      </span>
    </div>
  )
}

function ClassMessages({ courseCode, coach, channelName }: { courseCode: string; coach: Agent; channelName: string }) {
  const markers = useWS((s) => s.localMarkers)
  const jobs = useWS((s) => s.jobs)
  // One row per recording ("You flagged 4 moments"), not one per tap.
  const groups = new Map<string, LocalMarker[]>()
  for (const m of markers) if (m.courseCode === courseCode && !m.late) groups.set(m.lectureId ?? 'live', [...(groups.get(m.lectureId ?? 'live') ?? []), m])
  const extra: ExtraRow[] = [...groups].map(([k, ms]) => ({ key: `flags:${k}`, at: ms[0]!.createdAt, node: <MarkerGroupRow markers={ms} /> }))
  const flagKey = [...groups.values()].reduce((n, ms) => n + ms.length, 0)
  const live = Object.values(jobs)
    .filter((j) => j.courseCode === courseCode && !(j.phase === 'ready' && j.messageId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <Messages
      threadKey={classKey(courseCode)}
      agent={coach}
      inClass={courseCode}
      extra={extra}
      empty={<Empty channelName={channelName} courseCode={courseCode} />}
      footer={live.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
      footerKey={live.map((j) => `${j.id}:${j.phase}:${j.lecture?.status}`).join('|') + `#${flagKey}`}
    />
  )
}

/** A class channel (#cs-f212-dbms): Messages · Lectures · Schedule, with recording mode in the composer. */
export function ClassChannel({ courseCode, tab, lecture, seg }: { courseCode: string; tab: ClassTab; lecture: string | null; seg: string | null }) {
  const cls = useWS((s) => s.classes.find((c) => c.courseCode === courseCode))
  const channelName = useWS((s) => s.channels.find((c) => c.courseCode === courseCode)?.name ?? slugOf(courseCode))
  const coach = useWS((s) => s.agents.find((a) => a.id === 'academic_coach')) ?? COACH
  const loading = useWS((s) => s.loadingStudent)
  if (!cls) return <div className="flex flex-1 items-center justify-center text-sm text-ink-5">{loading ? 'Loading…' : `${courseCode} isn’t one of your registered classes.`}</div>
  return (
    <AudioDropZone courseCode={courseCode}>
      <Header cls={cls} tab={tab} />
      {tab === 'messages' && (
        <>
          <ClassMessages courseCode={courseCode} coach={coach} channelName={channelName} />
          <ClassComposer courseCode={courseCode} />
        </>
      )}
      {tab === 'lectures' && (lecture ? <HandoutView key={lecture} courseCode={courseCode} lectureId={lecture} focus={seg} /> : <LecturesTab courseCode={courseCode} />)}
      {tab === 'schedule' && (
        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
          <CalendarView courseCode={courseCode} hideCourseFilter />
        </div>
      )}
    </AudioDropZone>
  )
}
