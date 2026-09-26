import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { classPath, navigate } from '@/lib/route'
import { AUDIO_ACCEPT, uploadAudioFiles } from '@/store/companion'

/**
 * A hidden picker for recordings the student already has. Several files at once are fine: each one becomes
 * its own lecture. `input` must be rendered; `open()` shows the picker; `after` runs once files are picked.
 */
export function useAudioPicker(courseCode: string, after?: () => void) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      hidden
      multiple
      accept={AUDIO_ACCEPT}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        if (!files.length) return
        after?.()
        void uploadAudioFiles(courseCode, files)
      }}
    />
  )
  return { open: () => ref.current?.click(), input }
}

/** "Upload recording" beside "Record lecture" in the composer toolbar; the label shortens when the pane is narrow. */
export function UploadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip="Add a recording you already have (mp3, m4a, wav… or a video: mp4, mov, mkv…), or drop the files here"
      className="flex h-7 flex-none cursor-pointer items-center gap-1 rounded-md px-1.5 text-[13px] font-bold whitespace-nowrap text-ink transition-colors hover:bg-mist"
    >
      <Icon name="upload" size={18} className="text-ink-5" />
      Upload<span className="hidden @md:inline"> recording</span>
    </button>
  )
}

const hasFiles = (e: DragEvent | ReactDragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

/** Drop recordings anywhere on the class channel; they upload like picked files and progress shows in Messages. */
export function AudioDropZone({ courseCode, children }: { courseCode: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0) // dragenter/dragleave fire per child element: count them so the overlay doesn't flicker
  useEffect(() => {
    // A file dropped just outside the zone would make the browser open it and leave the app.
    const guard = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (!files.length) return
        navigate(classPath(courseCode))
        void uploadAudioFiles(courseCode, files)
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cyan bg-white/95 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-ink text-cyan">
            <Icon name="upload" size={26} />
          </span>
          <b className="text-[17px] text-ink">Drop to add the recording to {courseCode}</b>
          <span className="text-[13px] text-ink-5">mp3, m4a, wav, webm, ogg, flac, aac or a video (mp4, mov, mkv…) · each file becomes its own lecture</span>
        </div>
      )}
    </div>
  )
}
