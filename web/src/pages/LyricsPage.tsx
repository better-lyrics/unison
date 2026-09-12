import { IconBrandYoutube, IconCheck, IconCopy, IconDownload, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { LyricsRenderer } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { VariantList } from "@/components/VariantList"
import { VariantMetadata } from "@/components/VariantMetadata"
import { VoteControls } from "@/components/VoteControls"
import { YouTubeEmbed } from "@/components/YouTubeEmbed"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { cn } from "@/lib/cn"
import { fetchLyricsVariant, fetchLyricsVariants } from "@/lib/api"
import { downloadTextFile } from "@/lib/download"
import { lyricsFilename, MIME_BY_FORMAT } from "@/lib/lyrics-download"

type Mode = "synced" | "raw"
type CopyState = "idle" | "copied" | "failed"

const COPY_RESET_MS: Record<Exclude<CopyState, "idle">, number> = {
  copied: 1500,
  failed: 2500,
}

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied!",
  failed: "Copy failed",
}

const ICON_BUTTON_CLASS =
  "flex items-center justify-center rounded-md border border-unison-border bg-unison-bg-elevated p-2 text-unison-text-secondary transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover hover:text-unison-text"

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>("synced")
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
  )

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
      seekTo(seconds)
      play()
    },
    [seekTo, play],
  )

  const [copyState, setCopyState] = useState<CopyState>("idle")
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current)
        copyResetTimerRef.current = null
      }
    }
  }, [])

  const scheduleCopyReset = useCallback((state: Exclude<CopyState, "idle">) => {
    if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = setTimeout(() => {
      copyResetTimerRef.current = null
      if (isMountedRef.current) setCopyState("idle")
    }, COPY_RESET_MS[state])
  }, [])

  const handleCopy = useCallback(() => {
    const body = variantQuery.data?.variant.lyrics
    if (!body) return
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(body).then(
      () => {
        if (!isMountedRef.current) return
        setCopyState("copied")
        scheduleCopyReset("copied")
      },
      () => {
        if (!isMountedRef.current) return
        setCopyState("failed")
        scheduleCopyReset("failed")
      },
    )
  }, [variantQuery.data, scheduleCopyReset])

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
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard

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
          <YouTubeEmbed playerRef={ref} />
          <div className="flex items-center gap-2">
            <a
              href={`https://music.youtube.com/watch?v=${safeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open on YouTube Music"
              title="Open on YouTube Music"
              className={ICON_BUTTON_CLASS}
            >
              <IconBrandYoutube className="size-4" stroke={1.75} />
            </a>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!variant}
              aria-label="Download lyrics file"
              title="Download lyrics"
              className={cn(ICON_BUTTON_CLASS, "disabled:cursor-not-allowed disabled:opacity-60")}
            >
              <IconDownload className="size-4" stroke={1.75} />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!variant || !canCopy}
              aria-label="Copy lyrics body to clipboard"
              aria-live="polite"
              title="Copy lyrics"
              className={cn(
                ICON_BUTTON_CLASS,
                "disabled:cursor-not-allowed disabled:opacity-60",
                copyState === "idle" && "text-unison-text-secondary",
                copyState === "copied" && "text-green-500",
                copyState === "failed" && "text-amber-500",
              )}
            >
              {copyState === "copied" ? (
                <IconCheck className="size-4" stroke={1.75} />
              ) : copyState === "failed" ? (
                <IconX className="size-4" stroke={1.75} />
              ) : (
                <IconCopy className="size-4" stroke={1.75} />
              )}
              <span className="sr-only">{COPY_LABEL[copyState]}</span>
            </button>
          </div>
          {variant ? <VariantMetadata variant={variant} /> : null}
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
