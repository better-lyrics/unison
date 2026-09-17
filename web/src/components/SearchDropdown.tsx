import { Kbd } from "@/components/Kbd"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { cn } from "@/lib/cn"
import type { LyricsSearchHit } from "@/lib/types"

export type DropdownStatus = "prompt" | "loading" | "empty" | "results"

interface SearchDropdownProps {
  status: DropdownStatus
  results: LyricsSearchHit[]
  activeIndex: number | null
  getRowProps: (index: number, hit: LyricsSearchHit) => Record<string, unknown>
}

export function SearchDropdown({ status, results, activeIndex, getRowProps }: SearchDropdownProps) {
  if (status === "prompt") return <Prompt />
  if (status === "empty") return <NoMatch />
  if (status === "loading") {
    return (
      <>
        <SkeletonRows />
        <Footer />
      </>
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-0.5 p-1.5">
        {results.map((hit, index) => (
          <li key={hit.id}>
            <div
              {...getRowProps(index, hit)}
              data-active={activeIndex === index || undefined}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-unison-bg-hover",
                activeIndex === index && "bg-unison-bg-hover shadow-inset-rim",
              )}
            >
              <SongThumbnail videoId={hit.videoId} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-unison-text">{hit.song}</p>
                <p className="truncate text-xs text-unison-text-secondary">{hit.artist}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Footer />
    </>
  )
}

function Prompt() {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-[13px] text-unison-text-secondary">Search lyrics, songs, or artists</p>
      <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-unison-text-muted">
        Focus anytime with <Kbd keys={["Mod", "/"]} />
      </p>
    </div>
  )
}

function NoMatch() {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-[13px] text-unison-text-secondary">No matches</p>
      <p className="mt-1 text-xs text-unison-text-muted">Try the lyric line directly</p>
    </div>
  )
}

function SkeletonRows() {
  return (
    <ul className="flex flex-col gap-0.5 p-1.5">
      {skeletonKeys("search-suggest", 5).map((key) => (
        <li key={key} className="flex items-center gap-3 px-2.5 py-2">
          <Bone className="size-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Bone className="h-3 w-2/5" />
            <Bone className="h-2.5 w-1/4" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Footer() {
  return (
    <div className="flex items-center gap-3 border-t border-unison-border px-3 py-2 text-[11px] text-unison-text-muted">
      <span className="inline-flex items-center gap-1.5">
        <Kbd keys={["ArrowUp"]} />
        <Kbd keys={["ArrowDown"]} /> navigate
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Kbd keys={["Enter"]} /> open
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Kbd keys={["Mod", "Enter"]} /> all results
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Kbd keys={["Escape"]} /> close
      </span>
    </div>
  )
}
