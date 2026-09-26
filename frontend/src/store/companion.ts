// Class Companion flows: recording (MediaRecorder), the "I'm stuck" marker queue, and lecture jobs
// (upload → process → poll GET /lectures/:id every 2 s). State lives in the workspace store.
//
// The lecture only exists once its audio (or transcript) is uploaded — POST /lectures needs one of them —
// so taps during a recording are queued locally with their timestamp and posted in order right after the
// upload, before processing starts. Nothing blocks the recording, and a slow network only delays the queue.
import { api, ApiError, type NewLecture } from '@/api'
import { DEFAULT_AGENT } from '@/lib/config'
import { classKey, currentGeneration, errText, useWS, type LectureJob, type LocalMarker } from './workspace'

const LECTURE_POLL_MS = 2000
const THREAD_POLL_MS = 2000

const get = () => useWS.getState()
const set = useWS.setState
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Recording

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []

function release() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  recorder = null
}

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function elapsedSec() {
  const r = get().recording
  return r && r.status !== 'starting' ? (Date.now() - r.startedAt) / 1000 : 0
}

export async function startRecording(courseCode: string) {
  if (get().recording) return
  if (!canRecord()) {
    set({ recordingError: 'This browser can’t record audio here. Upload a recording instead, or paste a transcript from the + menu.' })
    return
  }
  set({ recording: { courseCode, startedAt: Date.now(), status: 'starting', noteFor: null }, recordingError: null })
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.start(1000)
    set({ recording: { courseCode, startedAt: Date.now(), status: 'recording', noteFor: null } })
  } catch (e) {
    release()
    set({ recording: null, recordingError: `Microphone unavailable (${errText(e)}). Upload a recording instead, or paste a transcript from the + menu.` })
  }
}

/** "I'm stuck": a timestamp now, an optional note after. Never waits on the network. */
export function tapStuck() {
  const r = get().recording
  if (!r || r.status !== 'recording') return
  const m: LocalMarker = {
    localId: `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    courseCode: r.courseCode,
    atSec: Math.round(elapsedSec()),
    createdAt: new Date().toISOString(),
    state: 'queued',
    attempts: 0,
  }
  set((s) => ({ localMarkers: [...s.localMarkers, m], recording: s.recording && { ...s.recording, noteFor: m.localId } }))
}

export function setMarkerNote(localId: string, note: string) {
  const clean = note.trim().slice(0, 60)
  set((s) => ({
    localMarkers: s.localMarkers.map((m) => (m.localId === localId && m.state === 'queued' && !m.lectureId ? { ...m, note: clean || undefined } : m)),
    recording: s.recording && { ...s.recording, noteFor: null },
  }))
}

export const closeNote = () => set((s) => ({ recording: s.recording && { ...s.recording, noteFor: null } }))

export async function stopRecording() {
  const r = get().recording
  if (!r || r.status !== 'recording' || !recorder) return
  set({ recording: { ...r, status: 'stopping', noteFor: null } })
  const rec = recorder
  const blob = await new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
    rec.stop()
  })
  release()
  set({ recording: null })
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
  const taps = get().localMarkers.filter((m) => m.courseCode === r.courseCode && !m.lectureId && Date.parse(m.createdAt) >= r.startedAt - 1000)
  if (!blob.size) {
    set({ recordingError: 'The recording came back empty — nothing was uploaded. Check the microphone and try again.' })
    return
  }
  void submitLecture(r.courseCode, { kind: 'audio', blob, filename: `lecture-${localDate()}.${ext}`, source: 'recording' }, taps.map((m) => m.localId))
}

// ---------------------------------------------------------------------------
// Marker queue: posts in tap order; transient failures back off and block the ones behind them

let flushing = false

const patchMarker = (localId: string, patch: Partial<LocalMarker>) => set((s) => ({ localMarkers: s.localMarkers.map((m) => (m.localId === localId ? { ...m, ...patch } : m)) }))

export async function flushMarkers() {
  if (flushing) return
  flushing = true
  const gen = currentGeneration()
  try {
    for (;;) {
      if (gen !== currentGeneration()) return
      const m = get().localMarkers.find((x) => x.lectureId && x.state === 'queued')
      if (!m) return
      patchMarker(m.localId, { state: 'posting' })
      try {
        const marker = await api.addMarker(m.lectureId!, { atSec: m.atSec, ...(m.note ? { note: m.note } : {}) })
        if (gen !== currentGeneration()) return
        patchMarker(m.localId, { state: 'posted', marker, error: undefined })
        afterMarkerPosted(m)
      } catch (e) {
        if (gen !== currentGeneration()) return
        const attempts = m.attempts + 1
        const permanent = e instanceof ApiError && !!e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429
        if (permanent || attempts >= 5) patchMarker(m.localId, { state: 'failed', attempts, error: errText(e) })
        else {
          patchMarker(m.localId, { state: 'queued', attempts, error: errText(e) })
          await sleep(Math.min(8000, 1000 * 2 ** (attempts - 1)))
        }
      }
    }
  } finally {
    flushing = false
  }
}

export function retryMarker(localId: string) {
  patchMarker(localId, { state: 'queued', attempts: 0, error: undefined })
  void flushMarkers()
}

/** A marker on a lecture that is already processed changes its handout and cards: reload them. */
function afterMarkerPosted(m: LocalMarker) {
  const lec = get().lectures.value?.find((l) => l.id === m.lectureId) ?? Object.values(get().jobs).find((j) => j.lecture?.id === m.lectureId)?.lecture
  if (lec?.status !== 'ready' || !m.lectureId) return
  void get().loadCards(m.lectureId, true)
  void get().loadHandout(m.lectureId, true)
  void get().loadMarkers(m.lectureId)
  void pollThreadFor(classKey(m.courseCode), 5)
}

async function waitForMarkers(lectureId: string, maxMs: number) {
  const until = Date.now() + maxMs
  while (Date.now() < until && get().localMarkers.some((m) => m.lectureId === lectureId && (m.state === 'queued' || m.state === 'posting'))) await sleep(200)
}

/** Flag a moment after the fact (handout timeline). Posted straight away through the same queue. */
export function addLateMarker(lectureId: string, courseCode: string, atSec: number, note?: string) {
  const m: LocalMarker = {
    localId: `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    courseCode,
    atSec: Math.max(0, Math.round(atSec)),
    note: note?.trim().slice(0, 60) || undefined,
    createdAt: new Date().toISOString(),
    state: 'queued',
    attempts: 0,
    lectureId,
    late: true,
  }
  set((s) => ({ localMarkers: [...s.localMarkers, m] }))
  void flushMarkers()
}

// ---------------------------------------------------------------------------
// Lecture jobs

type Input = { kind: 'audio'; blob: Blob; filename: string; source: 'recording' | 'upload' } | { kind: 'transcript'; text: string }

const inputs = new Map<string, { input: Input; studentId: string; markerIds: string[] }>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const patchJob = (id: string, patch: Partial<LectureJob>) => set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id]!, ...patch } } } : {}))

export async function submitLecture(courseCode: string, input: Input, markerIds: string[] = []) {
  const studentId = get().studentId
  if (!studentId) return
  const job: LectureJob = {
    // Several dropped files are submitted within the same millisecond: the suffix keeps their ids apart.
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    courseCode,
    source: input.kind === 'audio' ? input.source : 'transcript',
    ...(input.kind === 'audio' && input.source === 'upload' ? { filename: input.filename } : {}),
    createdAt: new Date().toISOString(),
    phase: 'uploading',
  }
  inputs.set(job.id, { input, studentId, markerIds })
  set((s) => ({ jobs: { ...s.jobs, [job.id]: job }, scrollTo: `job:${job.id}` }))
  await upload(job.id)
}

// What the backend's pipeline accepts: it goes by the file extension (AUDIO_EXTS in backend/app/tools/companion.py).
export const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.oga', '.opus', '.webm', '.flac', '.mp4', '.mpeg', '.mpga', '.aiff', '.aif', '.caf']
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTS].join(',')
const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '')

/** Recordings the student already has (file picker or drop): one lecture per file, uploaded in order. */
export async function uploadAudioFiles(courseCode: string, files: File[]) {
  const why = (f: File) => (!AUDIO_EXTS.includes(extOf(f.name)) ? 'not an audio format the companion reads' : !f.size ? 'empty file' : null)
  const skipped = files.filter((f) => why(f))
  set({ uploadError: skipped.length ? `Didn’t add ${skipped.map((f) => `${f.name} (${why(f)})`).join(', ')}. Recordings can be mp3, m4a, wav, webm, ogg, flac or aac.` : null })
  const gen = currentGeneration()
  for (const f of files) {
    if (gen !== currentGeneration()) return // student switched: the rest aren't theirs
    if (!why(f)) await submitLecture(courseCode, { kind: 'audio', blob: f, filename: f.name, source: 'upload' })
  }
}

export const pasteTranscript = (courseCode: string, text: string) => submitLecture(courseCode, { kind: 'transcript', text })

async function upload(jobId: string) {
  const job = get().jobs[jobId]
  const saved = inputs.get(jobId)
  if (!job || !saved) return
  const gen = currentGeneration()
  const { input, studentId, markerIds } = saved
  patchJob(jobId, { phase: 'uploading', error: undefined })
  const body: NewLecture =
    input.kind === 'audio'
      ? { studentId, courseCode: job.courseCode, date: localDate(), audio: input.blob, filename: input.filename, source: input.source }
      : { studentId, courseCode: job.courseCode, date: localDate(), transcriptText: input.text }
  let lectureId: string
  try {
    const lecture = await api.createLecture(body)
    if (gen !== currentGeneration()) return
    lectureId = lecture.id
    patchJob(jobId, { lecture, phase: 'processing' })
  } catch (e) {
    if (gen === currentGeneration()) patchJob(jobId, { phase: 'upload_failed', error: errText(e) })
    return
  }
  // Markers first (in tap order), so processing sees them; never wait on them for long.
  set((s) => ({ localMarkers: s.localMarkers.map((m) => (markerIds.includes(m.localId) ? { ...m, lectureId } : m)) }))
  void flushMarkers()
  await waitForMarkers(lectureId, 6000)
  await process(jobId)
}

async function process(jobId: string) {
  const job = get().jobs[jobId]
  if (!job?.lecture) return
  const gen = currentGeneration()
  patchJob(jobId, { phase: 'processing', error: undefined })
  try {
    const lecture = await api.processLecture(job.lecture.id)
    if (gen !== currentGeneration()) return
    patchJob(jobId, { lecture })
  } catch (e) {
    if (gen === currentGeneration()) patchJob(jobId, { phase: 'failed', error: `Couldn’t start processing: ${errText(e)}` })
    return
  }
  void get().refreshThread(classKey(job.courseCode))
  void get().loadLectures()
  void get().refreshClasses()
  schedulePoll(jobId)
}

function schedulePoll(jobId: string) {
  clearTimeout(timers.get(jobId))
  const gen = currentGeneration()
  timers.set(
    jobId,
    setTimeout(async () => {
      const job = get().jobs[jobId]
      if (!job?.lecture || gen !== currentGeneration()) return
      try {
        const lecture = await api.getLecture(job.lecture.id)
        if (gen !== currentGeneration()) return
        patchJob(jobId, { lecture, pollError: undefined, lastPollAt: Date.now() })
        if (lecture.status === 'ready') return void onReady(jobId)
        if (lecture.status === 'failed') {
          patchJob(jobId, { phase: 'failed', error: lecture.error ?? 'Processing failed' })
          void get().refreshThread(classKey(job.courseCode))
          void get().loadLectures()
          return
        }
      } catch (e) {
        if (gen !== currentGeneration()) return
        patchJob(jobId, { pollError: errText(e), lastPollAt: Date.now() })
      }
      schedulePoll(jobId)
    }, LECTURE_POLL_MS),
  )
}

async function onReady(jobId: string) {
  const job = get().jobs[jobId]
  if (!job?.lecture) return
  const lectureId = job.lecture.id
  patchJob(jobId, { phase: 'ready' })
  void get().loadCards(lectureId)
  void get().loadHandout(lectureId)
  void get().loadMarkers(lectureId)
  void get().loadLectures()
  void get().refreshClasses()
  void flushMarkers()
  // The agent message with the coverage + actions cards arrives through the thread: poll until it does.
  const messageId = await pollThreadFor(classKey(job.courseCode), 12, lectureId)
  if (messageId) {
    patchJob(jobId, { messageId })
    set({ scrollTo: messageId })
    return
  }
  // Not in the class thread (a backend without class threads posts it to the coach DM): look there, stop waiting.
  await get().refreshThread(DEFAULT_AGENT)
  const dm = get().threads[DEFAULT_AGENT]?.messages.find((m) => m.cards.some((c) => (c.type === 'coverage' || c.type === 'actions') && c.lectureId === lectureId))
  patchJob(jobId, { messageWaitDone: true, ...(dm ? { dmMessageId: dm.id } : {}) })
}

/** Refresh a thread every 2 s until a message carrying cards for `lectureId` shows up (or `tries` runs out). */
async function pollThreadFor(key: string, tries: number, lectureId?: string): Promise<string | undefined> {
  const gen = currentGeneration()
  for (let i = 0; i < tries; i++) {
    await get().refreshThread(key)
    if (gen !== currentGeneration()) return undefined
    const hit = lectureId && get().threads[key]?.messages.find((m) => m.cards.some((c) => (c.type === 'coverage' || c.type === 'actions') && c.lectureId === lectureId))
    if (hit) return hit.id
    if (!lectureId && i > 0) return undefined
    await sleep(THREAD_POLL_MS)
  }
  return undefined
}

export function retryJob(jobId: string) {
  const job = get().jobs[jobId]
  if (!job) return
  if (!job.lecture) void upload(jobId)
  else void process(jobId)
}

export function dismissJob(jobId: string) {
  clearTimeout(timers.get(jobId))
  inputs.delete(jobId)
  set((s) => {
    const jobs = { ...s.jobs }
    delete jobs[jobId]
    return { jobs }
  })
}

/** Student switch: stop timers; the store drops jobs and markers itself. */
export function resetCompanion() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  inputs.clear()
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  release()
}
