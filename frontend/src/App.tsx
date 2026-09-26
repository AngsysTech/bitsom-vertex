import { useEffect } from 'react'
import { CitationPopover } from '@/components/overlays/CitationPopover'
import { StudentSwitcher } from '@/components/overlays/StudentSwitcher'
import { TooltipLayer } from '@/components/overlays/TooltipLayer'
import { Rail } from '@/components/shell/Rail'
import { RightPanel } from '@/components/shell/RightPanel'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { AdvisorView } from '@/components/views/AdvisorView'
import { AgentsView } from '@/components/views/AgentsView'
import { ChannelView } from '@/components/views/ChannelView'
import { DmView } from '@/components/views/DmView'
import { DocView } from '@/components/views/DocView'
import { FilesView } from '@/components/views/FilesView'
import { POLL_MS } from '@/lib/config'
import { parseHash } from '@/lib/route'
import { useWS } from '@/store/workspace'
import type { AgentId } from '@/types'

function useAppEffects() {
  useEffect(() => {
    const s = useWS.getState()
    s.onRoute(parseHash(window.location.hash))
    void s.bootstrap()

    const onHash = () => useWS.getState().onRoute(parseHash(window.location.hash))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useWS.getState().set({ switcherOpen: false, pop: null })
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useWS.getState().set((st) => ({ switcherOpen: !st.switcherOpen }))
      }
    }
    // Student threads poll while an escalation is open; the advisor inbox polls while it is on screen.
    const poll = setInterval(() => {
      const st = useWS.getState()
      for (const [agentId, t] of Object.entries(st.threads))
        if (t.messages.some((m) => m.escalation?.status === 'open')) void st.refreshThread(agentId as AgentId)
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
      <TooltipLayer />
    </div>
  )
}
