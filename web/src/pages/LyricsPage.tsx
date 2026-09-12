import { useQuery } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { LyricsRenderer } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { VariantList } from "@/components/VariantList"
import { VariantMetadata } from "@/components/VariantMetadata"
import { VoteControls } from "@/components/VoteControls"
import { YouTubeMusicIcon } from "@/components/icons/YouTubeMusicIcon"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { cn } from "@/lib/cn"
import { fetchLyricsVariant, fetchLyricsVariants } from "@/lib/api"
import { downloadTextFile } from "@/lib/download"
import { lyricsFilename, MIME_BY_FORMAT } from "@/lib/lyrics-download"

type Mode = "synced" | "raw"

const HEADER_ACTION_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-unison-border bg-unison-bg-elevated px-2 py-1 text-xs text-unison-text-secondary transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover hover:text-unison-text"

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>("synced")
  const [playerActive, setPlayerActive] = useState(false)
  const variantIdParam = params.get("variantId")
  const navigate = useNavigate()
  const location = useLocation()

  const handleBack = useCallback(() => {
    if (location.key === "default") navigate("/")
    else navigate(-1)
  }, [location.key, navigate])

  const safeVideoId = videoId ?? ""
  const { ref, getCurrentTime, getPlaying, seekTo, play } = useYouTubePlayer(
    safeVideoId.length > 0 ? safeVideoId : null,
    { playerVars: { autoplay: 1 } },
  )

  const [playerVideoId, setPlayerVideoId] = useState(safeVideoId)
  if (safeVideoId !== playerVideoId) {
    setPlayerVideoId(safeVideoId)
    setPlayerActive(false)
  }

  const activatePlayer = useCallback(() => setPlayerActive(true), [])

  const variantsQuery = useQuery({
    queryKey: ["lyrics", "variants", safeVideoId],
    queryFn: ({ signal }) => fetchLyricsVariants(safeVideoId, { signal }),
    enabled: safeVideoId.length > 0,
    staleTime: 30_000,
  })

  const variants = useMemo(() => variantsQuery.data?.variants ?? [], [variantsQuery.data])
  const requestedId = variantIdParam !== null ? Number(variantIdParam) : null
  const selectedId = useMemo(() => {
    if (requestedId !== null && variants.some((v) => v.id === requestedId)) return requestedId
    return variants[0]?.id
  }, [requestedId, variants])

  const variantQuery = useQuery({
    queryKey: ["lyrics", "variant", selectedId],
    queryFn: ({ signal }) => {
      if (selectedId === undefined) throw new Error("no variant selected")
      return fetchLyricsVariant(selectedId, { signal })
    },
    enabled: selectedId !== undefined,
    staleTime: 30_000,
  })

  const handleSelect = useCallback(
    (id: number) => {
      const next = new URLSearchParams(params)
      next.set("variantId", String(id))
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  // Seeking a paused player leaves it paused, so clicking a line would land on the line and sit
  // there in silence.
  const handleLineClick = useCallback(
    (seconds: number) => {
      setPlayerActive(true)
      seekTo(seconds)
      play()
    },
    [seekTo, play],
  )

  const handleDownload = useCallback(() => {
    const v = variantQuery.data?.variant
    if (!v) return
    downloadTextFile(lyricsFilename(v), v.lyrics, MIME_BY_FORMAT[v.format])
  }, [variantQuery.data])

  if (!videoId) return <EmptyState title="No video specified" />

  if (variantsQuery.isLoading) return <LoadingPlaceholder rows={4} />
  if (variantsQuery.isError) {
    const message = variantsQuery.error instanceof Error ? variantsQuery.error.message : "Unknown error"
    return <EmptyState title="Could not load lyrics" hint={message} />
  }
  if (variants.length === 0) {
    return <EmptyState title="No lyrics yet" hint="Request this song via the Better Lyrics extension." />
  }

  const variant = variantQuery.data?.variant

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="cursor-pointer text-xs text-unison-text-muted transition-colors hover:text-unison-text"
        >
          ‹ back
        </button>
        {variant && selectedId !== undefined ? (
          <VoteControls
            variantId={variant.id}
            videoId={safeVideoId}
            variant={{ score: variant.score, userVote: variant.userVote ?? null }}
          />
        ) : null}
      </div>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,384px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {variant ? (
            <VariantMetadata
              variant={variant}
              playerRef={ref}
              playerActive={playerActive}
              onActivatePlayer={activatePlayer}
            />
          ) : null}
          <a
            href={`https://music.youtube.com/watch?v=${safeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-[10px] bg-white/[0.08] px-4 py-3 text-[13px] font-semibold text-unison-text shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.07)] transition-colors hover:bg-white/[0.12] active:translate-y-px"
          >
            <YouTubeMusicIcon className="size-[18px]" />
            Open on YouTube Music
          </a>
        </div>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-unison-border/60 px-3 py-2">
              <fieldset className="inline-flex rounded-md bg-unison-bg p-0.5">
                <legend className="sr-only">Lyrics display mode</legend>
                <button
                  type="button"
                  onClick={() => setMode("synced")}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    mode === "synced"
                      ? "bg-unison-bg-hover text-unison-text"
                      : "text-unison-text-muted hover:text-unison-text",
                  )}
                >
                  Synced
                </button>
                <button
                  type="button"
                  onClick={() => setMode("raw")}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    mode === "raw"
                      ? "bg-unison-bg-hover text-unison-text"
                      : "text-unison-text-muted hover:text-unison-text",
                  )}
                >
                  Raw
                </button>
              </fieldset>
              {variant ? (
                <div className="flex items-center gap-2">
                  <DownloadButton
                    onClick={handleDownload}
                    className={HEADER_ACTION_CLASS}
                    iconClassName="size-3.5"
                    withText
                  />
                  <CopyButton text={variant.lyrics} className={HEADER_ACTION_CLASS} iconClassName="size-3.5" withText />
                </div>
              ) : null}
            </div>
            <div className="p-4">
              {variantQuery.isLoading || !variant ? (
                <LoadingPlaceholder rows={3} />
              ) : mode === "synced" ? (
                <LyricsRenderer
                  variant={variant}
                  getCurrentTime={getCurrentTime}
                  getPlaying={getPlaying}
                  onLineClick={handleLineClick}
                />
              ) : (
                <RawLyricsView body={variant.lyrics} format={variant.format} />
              )}
            </div>
          </div>
          <VariantList variants={variants} selectedId={selectedId ?? -1} onSelect={handleSelect} />
        </div>
      </div>
    </div>
  )
}
