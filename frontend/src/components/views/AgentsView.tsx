import { Icon } from '@/components/Icon'
import { useScopeChips } from '@/hooks/useScopeChips'
import { COMING_SOON_AGENTS, COMING_SOON_CLUBS, CONNECTOR_KIND_LABEL, PROVIDES_LABEL } from '@/lib/labels'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { Agent, Connector } from '@/types'

const BADGE: Record<Connector['status'], { label: string; cls: string; dot: string }> = {
  synthetic: { label: 'Synthetic', cls: 'border-cyan bg-white text-ink', dot: 'bg-cyan' },
  connected: { label: 'Connected', cls: 'border-ok bg-ok-soft text-ink', dot: 'bg-ok' },
  available: { label: 'Available', cls: 'border-line bg-soft text-ink-5', dot: 'bg-ink-4' },
}

function AgentCard({ agent }: { agent: Agent }) {
  const chips = useScopeChips(agent)
  const set = useWS((s) => s.set)
  const club = agent.kind === 'club'
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 flex-none items-center justify-center rounded-[10px] border border-line bg-soft text-2xl">{agent.emoji}</span>
        <div className="flex flex-col gap-0.5">
          <b className="text-[15px]">
            {agent.name}
            {club && <span className="ml-1.5 rounded-[3px] bg-mist px-1 py-px align-middle text-[10px] font-bold tracking-[.04em] text-ink-5">CLUB</span>}
          </b>
          <span className="text-[13px] leading-[18px] text-ink-5">{agent.tagline}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-5">Reads:</span>
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => navigate(`/files/${c.docIds[0]}`)}
            data-tip={c.docIds.length > 1 ? `${c.docIds.length} documents` : undefined}
            className="h-[22px] cursor-pointer rounded-full border border-line bg-soft px-2 text-xs text-ink hover:border-ink-5"
          >
            {c.label}
            {c.docIds.length > 1 && <span className="ml-1 text-ink-4">{c.docIds.length}</span>}
          </button>
        ))}
      </div>
      {club ? (
        <span className="mt-auto text-xs text-ink-5">Replies inside Campus Guide threads when @mentioned.</span>
      ) : (
        <button
          type="button"
          onClick={() => {
            set({ rail: 'home' })
            navigate(`/dm/${agent.id}`)
          }}
          className="mt-auto h-[30px] cursor-pointer self-start rounded-md bg-ink px-3.5 text-[13px] font-bold text-white"
        >
          Open DM
        </button>
      )}
    </div>
  )
}

/** Below the line today: greyed, no Open DM, never a simulated reply. */
function ComingSoonCard({ emoji, name, tagline }: { emoji: string; name: string; tagline: string }) {
  return (
    <div data-tip="Coming soon" className="flex cursor-not-allowed flex-col gap-2.5 rounded-[10px] border border-dashed border-line bg-soft p-4 opacity-70">
      <div className="flex items-center gap-3">
        <span className="flex size-11 flex-none items-center justify-center rounded-[10px] border border-line bg-white text-2xl grayscale">{emoji}</span>
        <div className="flex flex-col gap-0.5">
          <b className="text-[15px] text-ink-5">{name}</b>
          <span className="text-[13px] leading-[18px] text-ink-5">{tagline}</span>
        </div>
      </div>
      <span className="mt-auto inline-flex items-center gap-1 self-start rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-ink-5">
        <Icon name="lock" size={13} /> Coming soon
      </span>
    </div>
  )
}

function ConnectorCard({ c }: { c: Connector }) {
  const b = BADGE[c.status]
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <b className="text-[15px]">{c.name}</b>
          <span className="text-xs text-ink-5">{CONNECTOR_KIND_LABEL[c.kind] ?? c.kind}</span>
        </div>
        <span className={cn('inline-flex h-[22px] flex-none items-center gap-[5px] rounded-full border px-[9px] text-[11px] font-bold', b.cls)}>
          <span className={cn('size-1.5 rounded-full', b.dot)} />
          {b.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {c.provides.map((p) => (
          <span key={p} className="inline-flex h-[22px] items-center rounded-full border border-line bg-soft px-2 text-xs">
            {PROVIDES_LABEL[p] ?? p}
          </span>
        ))}
      </div>
      {c.status === 'available' && (
        <span data-tip="Coming soon" className="inline-flex h-7 cursor-not-allowed items-center self-start rounded-md border border-line px-3 text-[13px] font-bold text-ink-4">
          Connect
        </span>
      )}
    </div>
  )
}

export function AgentsView() {
  const tab = useWS((s) => s.agentsTab)
  const agents = useWS((s) => s.agents)
  const connectors = useWS((s) => s.connectors)
  const set = useWS((s) => s.set)
  const tabCls = (on: boolean) =>
    cn('cursor-pointer border-b-2 px-0.5 py-2 text-[13px] font-bold', on ? 'border-ink text-ink' : 'border-transparent text-ink-5')

  return (
    <>
      <div className="flex-none border-b border-line px-6 pt-4">
        <span className="text-xl font-black">Agents &amp; tools</span>
        <div className="mt-2.5 flex gap-5">
          <button type="button" onClick={() => set({ agentsTab: 'agents' })} className={tabCls(tab === 'agents')}>
            Installed agents
          </button>
          <button type="button" onClick={() => set({ agentsTab: 'connectors' })} className={tabCls(tab === 'connectors')}>
            Connectors
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'agents' ? (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {agents.filter((a) => a.kind !== 'club').map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
            <div className="mt-6 mb-2.5 text-[11px] font-bold tracking-[.06em] text-ink-5 uppercase">Coming soon</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {COMING_SOON_AGENTS.filter((c) => !agents.some((a) => a.id === c.id)).map((c) => (
                <ComingSoonCard key={c.id} emoji={c.emoji} name={c.name} tagline={c.tagline} />
              ))}
              {COMING_SOON_CLUBS.map((c) => (
                <ComingSoonCard key={c.name} emoji={c.emoji} name={c.name} tagline={c.tagline} />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {connectors.map((c) => (
                <ConnectorCard key={c.id} c={c} />
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[13px] text-ink-5">
              <Icon name="info" size={16} />
              Synthetic connectors are seeded with demo data. Real sync is not built.
            </p>
          </>
        )}
      </div>
    </>
  )
}
