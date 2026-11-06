import { useQueries } from "@tanstack/react-query"
import { type RefObject, useCallback, useState } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserSubmissions, putProfileSettings } from "@/lib/api"
import { artworkQuery } from "@/lib/artwork"
import { AuthedFetchError } from "@/lib/authedFetch"
import { cn } from "@/lib/cn"

const TILE_SIZE = 400

interface BannerPickerProps {
  ref: RefObject<HTMLDivElement | null>
  keyId: string
  current: string | null
  onSaved: () => Promise<void>
}

export function BannerPicker({ ref, keyId, current, onSaved }: BannerPickerProps) {
  const fetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const submissions = useAsyncData(fetcher, `user:submissions:${keyId}`)
  const seenVideos = new Set<string>()
  const songs =
    submissions.status === "success"
      ? submissions.data.submissions.filter((s) => !seenVideos.has(s.videoId) && seenVideos.add(s.videoId))
      : []
  const arts = useQueries({ queries: songs.map((s) => artworkQuery(s.videoId, TILE_SIZE)) })
  const seenArt = new Set<string>()
  const covers = songs.flatMap((song, i) => {
    const url = arts[i]?.data
    if (!url || seenArt.has(url)) return []
    seenArt.add(url)
    return [{ song, url }]
  })

  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (banner: string | null) => {
    setSaving(banner ?? "remove")
    setError(null)
    try {
      await putProfileSettings({ banner })
      await onSaved()
      ref.current?.hidePopover()
    } catch (err) {
      setError(err instanceof AuthedFetchError && err.hint ? err.hint : "Could not save the banner. Try again.")
    } finally {
      setSaving(null)
    }
  }

  return (
    <div
      ref={ref}
      popover="auto"
      className="fixed inset-[128px_32px_auto_auto] m-0 max-h-[min(520px,calc(100dvh-160px))] w-[360px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-[22px] border-0 bg-[rgba(20,19,24,0.82)] p-[18px] text-unison-text shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px] backdrop-saturate-[1.4] max-[1000px]:inset-[auto_16px_80px_16px] max-[1000px]:w-auto"
    >
      <h2 className="m-0 text-[15px] font-bold">Banner</h2>
      <p className="mt-1 mb-3.5 text-xs text-(--ink-3)">Pick the cover of a song you synced.</p>
      <div className="grid grid-cols-4 gap-2">
        {covers.map(({ song, url }) => (
          <button
            key={song.videoId}
            type="button"
            aria-label={song.song}
            title={song.song}
            aria-pressed={song.videoId === current}
            disabled={saving !== null}
            onClick={() => pick(song.videoId)}
            className={cn(
              "relative aspect-square cursor-pointer overflow-hidden rounded-[10px] transition-[scale,opacity] duration-150 ease-out enabled:active:scale-[0.96] disabled:cursor-wait",
              "after:absolute after:inset-0 after:rounded-[inherit] after:outline after:outline-1 after:-outline-offset-1 after:outline-white/10 after:content-['']",
              "aria-pressed:after:outline-2 aria-pressed:after:-outline-offset-2 aria-pressed:after:outline-unison-text",
              saving === song.videoId && "opacity-60",
            )}
          >
            <img src={url} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      {current ? (
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => pick(null)}
          className="mt-3.5 h-9 cursor-pointer rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-(--ink-2) transition-[scale] duration-150 ease-out enabled:active:scale-[0.96] disabled:cursor-wait"
        >
          Remove banner
        </button>
      ) : null}
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </div>
  )
}
