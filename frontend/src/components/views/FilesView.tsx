import { Icon } from '@/components/Icon'
import { SyntheticBadge } from '@/components/SyntheticBadge'
import { useFileSource } from '@/hooks/useFileSource'
import { fmtDate } from '@/lib/format'
import { fileIcon } from '@/lib/labels'
import { navigate } from '@/lib/route'
import { cn } from '@/lib/utils'
import { useWS } from '@/store/workspace'
import type { WorkspaceFile } from '@/types'

function FileRow({ f }: { f: WorkspaceFile }) {
  const src = useFileSource(f)
  return (
    <div
      onClick={() => navigate(`/files/${f.id}`)}
      className="grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-soft"
    >
      <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-soft text-ink-5">
        <Icon name={fileIcon(f)} size={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <b className="truncate text-[15px]">{f.title}</b>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-5">
          <span>{src.label}</span>
          {src.synthetic && <SyntheticBadge />}
          {f.kind === 'document' && f.effectiveDate && <span>· Effective {fmtDate(f.effectiveDate)}</span>}
        </div>
      </div>
      <span className="text-xs text-ink-5">Updated {fmtDate(f.updatedAt)}</span>
    </div>
  )
}

export function FilesView() {
  const files = useWS((s) => s.files)
  const filter = useWS((s) => s.filesFilter)
  const loading = useWS((s) => s.loadingStudent)
  const set = useWS((s) => s.set)
  const rows = files.filter((f) => filter === 'all' || f.kind === filter)
  const title = { all: 'All files', document: 'Documents', canvas: 'Canvases' }[filter]

  return (
    <>
      <div className="flex flex-none flex-col gap-3 border-b border-line px-6 pt-4 pb-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xl font-black">{title}</span>
          <div data-tip="Coming soon" className="flex h-[30px] w-[280px] cursor-not-allowed items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] text-ink-5">
            <Icon name="search" size={16} />
            Search files
          </div>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ['all', 'All'],
              ['document', 'Documents'],
              ['canvas', 'Canvases'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => set({ filesFilter: id })}
              className={cn(
                'h-7 cursor-pointer rounded-full border px-3 text-[13px] font-bold',
                filter === id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1.5">
        {loading && !files.length && <div className="px-3 py-3 text-sm text-ink-5">Loading…</div>}
        {!loading && !rows.length && <div className="px-3 py-3 text-sm text-ink-5">Nothing here yet.</div>}
        {rows.map((f) => (
          <FileRow key={f.id} f={f} />
        ))}
      </div>
    </>
  )
}
