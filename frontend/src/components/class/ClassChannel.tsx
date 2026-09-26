import { useRef } from 'react'
import { CalendarView } from '@/components/calendar/CalendarView'
import { Composer } from '@/components/chat/Composer'
import { Messages, type ExtraRow } from '@/components/chat/Messages'
import { Icon } from '@/components/Icon'
import { classPath, navigate, type ClassTab } from '@/lib/route'
import { fmtDayShort, fmtHM, inDays } from '@/lib/time'
import { cn } from '@/lib/utils'
import { startRecording, uploadAudio } from '@/store/companion'
import { classKey, useWS } from '@/store/workspace'
import type { Agent, ClassChannel as ClassChannelT } from '@/types'
import { HandoutView } from './HandoutView'
import { LecturesTab } from './LecturesTab'
import { JobRow, MarkerRow } from './LectureRows'
import { RecordingBar } from './RecordingBar'

const COACH: Agent = { id: 'academic_coach', kind: 'specialist', name: 'Academic Coach', tagline: '', emoji: '🎓', scope: [], starters: [] }
const EXAM_LABEL = { quiz: 'Quiz', mid_sem: 'Mid-sem', end_sem: 'End-sem' } as const
const slugOf = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function ReadsChips({ courseCode }: { courseCode: string }) {
  const files = useWS((s) => s.files)
  const doc = (kind: string, match?: (id: string, title: string) => boolean) =>
    files.find((f) => f.kind === 'document' && f.docKind === kind && (!match || match(f.id, f.title)))
  const syllabus = doc('syllabus', (id, title) => id === `syllabus.${slugOf(courseCode)}` || title.startsWith(courseCode))
  const papers = doc('past_papers')
  const exams = doc('exam_calendar')
  const chips: { label: string; icon: string; go?: () => void }[] = [
    { label: 'Syllabus', icon: 'menu_book', go: syllabus && (() => navigate(`/files/${syllabus.id}`)) },
    { label: 'Lectures', icon: 'mic', go: () => navigate(classPath(courseCode, 'lectures')) },
    { label: 'Past papers', icon: 'quiz', go: papers && (() => navigate(`/files/${papers.id}`)) },
    { label: 'Exam calendar', icon: 'event', go: exams && (() => navigate(`/files/${exams.id}/exam_calendar.${slugOf(courseCode)}`)) },
  ]
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-5">Reads:</span>
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          disabled={!c.go}
          onClick={c.go}
          data-tip={c.go ? undefined : 'Not in this workspace’s files'}
          className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-full border border-line bg-soft px-2 text-xs text-ink hover:border-ink-5 disabled:cursor-default disabled:opacity-50"
        >
          <Icon name={c.icon} size={14} className="text-ink-5" />
          {c.label}
        </button>
      ))}
    </div>
  )
}

function Header({ cls, tab }: { cls: ClassChannelT; tab: ClassTab }) {
  const starred = useWS((s) => s.starred.includes(cls.channelId))
  const panelOpen = useWS((s) => s.panelOpen)
  const set = useWS((s) => s.set)
  const lectures = useWS((s) => s.lectures.value?.filter((l) => l.courseCode === cls.courseCode).length ?? 0)
  const tabCls = (on: boolean) => cn('flex cursor-pointer items-center gap-1 border-b-2 px-0.5 py-2 text-[13px] font-bold', on ? 'border-ink text-ink' : 'border-transparent text-ink-5')
  return (
    <div className="flex-none border-b border-line px-5 pt-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-line bg-soft text-lg">📘</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-lg font-black">
              {cls.courseCode} · {cls.title}
            </span>
            <button
              type="button"
              onClick={() => set((s) => ({ starred: starred ? s.starred.filter((x) => x !== cls.channelId) : [...s.starred, cls.channelId] }))}
              data-tip={starred ? 'Remove from Starred' : 'Star channel'}
              className="flex cursor-pointer p-0.5 text-ink-5"
            >
              <Icon name="star" size={18} fill={starred} />
            </button>
          </div>
          <span className="text-[13px] text-ink-5">
            {cls.faculty} · Slot {cls.slot}
          </span>
        </div>
        {!panelOpen && (
          <button type="button" onClick={() => set({ panelOpen: true })} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-bold text-ink">
            <Icon name="view_sidebar" size={18} />
            Context
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {cls.nextSessionAt && (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-ink px-2.5 text-xs font-bold">
            <Icon name="schedule" size={14} />
            Next session {fmtDayShort(cls.nextSessionAt)} {fmtHM(cls.nextSessionAt)}
            {cls.nextSessionRoom && ` · ${cls.nextSessionRoom}`}
            {cls.prepDue > 0 && <span className="rounded-full bg-warn-soft px-1.5 text-warn-ink">{cls.prepDue} prep due</span>}
          </span>
        )}
        {cls.examAt && (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-bad bg-bad-soft px-2.5 text-xs font-bold">
            <Icon name="event" size={14} className="text-bad" />
            {EXAM_LABEL[cls.examKind ?? 'quiz']} {inDays(cls.examAt)}
          </span>
        )}
      </div>
      <ReadsChips courseCode={cls.courseCode} />
      <div className="mt-1.5 flex gap-5">
        <button type="button" onClick={() => navigate(classPath(cls.courseCode))} className={tabCls(tab === 'messages')}>
          Messages
        </button>
        <button type="button" onClick={() => navigate(classPath(cls.courseCode, 'lectures'))} className={tabCls(tab === 'lectures')}>
          <Icon name="mic" size={16} />
          Lectures {lectures > 0 && <span className="text-ink-4">{lectures}</span>}
        </button>
        <button type="button" onClick={() => navigate(classPath(cls.courseCode, 'schedule'))} className={tabCls(tab === 'schedule')}>
          <Icon name="calendar_month" size={16} />
          Schedule
        </button>
      </div>
    </div>
  )
}

function RecordButton({ courseCode, disabled }: { courseCode: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void startRecording(courseCode)}
      data-tip="Record this class · R"
      className="flex w-[108px] flex-none cursor-pointer flex-col items-center justify-center gap-1.5 self-stretch rounded-lg bg-cyan px-2 text-[13px] leading-4 font-black text-ink hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-white">
        <span className="size-3 rounded-full bg-bad" />
      </span>
      Record lecture
      <kbd className="rounded border border-ink/30 px-1 font-mono text-[10px] font-bold">R</kbd>
    </button>
  )
}

function ClassComposer({ courseCode }: { courseCode: string }) {
  const recording = useWS((s) => s.recording)
  const recordingError = useWS((s) => s.recordingError)
  const set = useWS((s) => s.set)
  const file = useRef<HTMLInputElement>(null)
  if (recording?.courseCode === courseCode) return <RecordingBar />
  const elsewhere = recording && recording.courseCode !== courseCode ? recording.courseCode : null
  return (
    <>
      {(recordingError || elsewhere) && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-md border border-line bg-soft px-3 py-2 text-[13px] text-ink-5">
          <Icon name={elsewhere ? 'mic' : 'mic_off'} size={16} className={elsewhere ? 'text-bad' : 'text-ink-4'} />
          {elsewhere ? (
            <>
              Recording in progress in {elsewhere} —
              <button type="button" onClick={() => navigate(classPath(elsewhere))} className="cursor-pointer font-bold text-link">
                go there
              </button>
            </>
          ) : (
            <>
              <span className="flex-1">{recordingError}</span>
              <button type="button" onClick={() => set({ recordingError: null })} className="cursor-pointer text-xs font-bold text-link">
                dismiss
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={file}
        type="file"
        hidden
        accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.opus,.flac,.aac"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadAudio(courseCode, f)
          e.target.value = ''
        }}
      />
      <Composer
        threadKey={classKey(courseCode)}
        placeholder={`Message Academic Coach about ${courseCode}`}
        left={<RecordButton courseCode={courseCode} disabled={!!elsewhere} />}
        plus={[
          { icon: 'upload_file', label: 'Upload audio', hint: 'A recording of the class (mp3, m4a, wav, webm)', onClick: () => file.current?.click() },
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
        The Academic Coach here reads only {courseCode}: its syllabus, lectures, past papers and exam dates. Record the next class and tap <b className="text-ink">I’m stuck</b> when you get lost; the handout, coverage and actions land here.
      </span>
    </div>
  )
}

function ClassMessages({ courseCode, coach, channelName }: { courseCode: string; coach: Agent; channelName: string }) {
  const markers = useWS((s) => s.localMarkers)
  const jobs = useWS((s) => s.jobs)
  const extra: ExtraRow[] = markers.filter((m) => m.courseCode === courseCode && !m.late).map((m) => ({ key: m.localId, at: m.createdAt, node: <MarkerRow m={m} /> }))
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
      footerKey={live.map((j) => `${j.id}:${j.phase}:${j.lecture?.status}`).join('|')}
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
    <>
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
    </>
  )
}
