import { useEffect } from 'react'
import { ClassChannel } from '@/components/class/ClassChannel'
import { PasteDialog } from '@/components/class/PasteDialog'
import { CitationPopover } from '@/components/overlays/CitationPopover'
import { StudentSwitcher } from '@/components/overlays/StudentSwitcher'
import { TooltipLayer } from '@/components/overlays/TooltipLayer'
import { Rail } from '@/components/shell/Rail'
import { RightPanel } from '@/components/shell/RightPanel'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { AdvisorView } from '@/components/views/AdvisorView'
import { AgentsView } from '@/components/views/AgentsView'
import { CalendarPage } from '@/components/views/CalendarPage'
import { ChannelView } from '@/components/views/ChannelView'
import { DmView } from '@/components/views/DmView'
import { DocView } from '@/components/views/DocView'
import { FilesView } from '@/components/views/FilesView'
import { POLL_MS } from '@/lib/config'
import { classPath, navigate, parseHash } from '@/lib/route'
import { closeNote, startRecording, stopRecording, tapStuck } from '@/store/companion'
import { useWS } from '@/store/workspace'

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function useAppEffects() {
  useEffect(() => {
    const s = useWS.getState()
    s.onRoute(parseHash(window.location.hash))
    void s.bootstrap()

    const onHash = () => useWS.getState().onRoute(parseHash(window.location.hash))
    const onKey = (e: KeyboardEvent) => {
      const st = useWS.getState()
      if (e.key === 'Escape') {
        // Esc stops a recording (the note field handles its own Esc first).
        if (st.recording && !typing(e)) {
          e.preventDefault()
          if (st.recording.noteFor) closeNote()
          else void stopRecording()
          return
        }
        st.set({ switcherOpen: false, pop: null, paste: null })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        st.set((x) => ({ switcherOpen: !x.switcherOpen }))
        return
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const k = e.key.toLowerCase()
      // R starts recording in a class channel; S taps "I'm stuck" while recording.
      if (k === 'r' && st.route.view === 'class' && !st.recording && !st.paste) {
        e.preventDefault()
        if (st.route.tab !== 'messages') navigate(classPath(st.route.id))
        void startRecording(st.route.id)
      } else if (k === 's' && st.recording?.status === 'recording') {
        e.preventDefault()
        tapStuck()
      }
    }
    // Student threads poll while an escalation is open; the advisor inbox polls while it is on screen.
    const poll = setInterval(() => {
      const st = useWS.getState()
      for (const [key, t] of Object.entries(st.threads)) if (t.messages.some((m) => m.escalation?.status === 'open')) void st.refreshThread(key)
      if (st.route.view === 'advisor') void st.loadTickets()
    }, POLL_MS)

    window.addEventListener('hashchange', onHash)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('keydown', onKey)
      clearInterval(poll)
    }
  }, [])
}

function MainPane() {
  const route = useWS((s) => s.route)
  switch (route.view) {
    case 'dm':
      return <DmView key={route.id} agentId={route.id} />
    case 'channel':
      return <ChannelView channelId={route.id} />
    case 'class':
      return <ClassChannel key={route.id} courseCode={route.id} tab={route.tab} lecture={route.lecture} seg={route.seg} />
    case 'calendar':
      return <CalendarPage />
    case 'files':
      return <FilesView />
    case 'doc':
      return <DocView key={route.id} docId={route.id} sec={route.sec} />
    case 'agents':
      return <AgentsView />
    case 'advisor':
      return <AdvisorView />
  }
}

function BootScreen() {
  const boot = useWS((s) => s.boot)
  const bootstrap = useWS((s) => s.bootstrap)
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ink text-[13px] text-ink-4">
      {boot.status === 'error' ? (
        <>
          <span className="text-bad">Couldn’t load the workspace: {boot.error}</span>
          <button type="button" onClick={() => void bootstrap()} className="cursor-pointer rounded-md border border-ink-6 px-3 py-1 font-bold text-white">
            Try again
          </button>
        </>
      ) : (
        'Loading workspace…'
      )}
    </div>
  )
}

export default function App() {
  useAppEffects()
  const ready = useWS((s) => s.boot.status === 'ready')
  if (!ready) return <BootScreen />
  return (
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden bg-ink text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <MainPane />
        </main>
        <RightPanel />
      </div>
      <StudentSwitcher />
      <CitationPopover />
      <PasteDialog />
      <TooltipLayer />
    </div>
  )
}
