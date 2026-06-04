import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { LyricsRenderer } from "@/components/LyricsRenderer"
import { VariantList } from "@/components/VariantList"
import { VariantMetadata } from "@/components/VariantMetadata"
import { YouTubeEmbed } from "@/components/YouTubeEmbed"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { cn } from "@/lib/cn"
import { fetchLyricsVariant, fetchLyricsVariants } from "@/lib/api"

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

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>("synced")
  const variantIdParam = params.get("variantId")

  const safeVideoId = videoId ?? ""
  const { ref, currentTimeMs, playing, seekTo } = useYouTubePlayer(safeVideoId.length > 0 ? safeVideoId : null)

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
      setParams(next, { replace: false })
    },
    [params, setParams],
  )

  const handleLineClick = useCallback((seconds: number) => seekTo(seconds), [seekTo])

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
      <Link to="/" className="text-xs text-unison-text-muted hover:text-unison-text">
        ‹ back
      </Link>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <YouTubeEmbed playerRef={ref} />
          {variant ? <VariantMetadata variant={variant} /> : null}
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <fieldset className="inline-flex rounded-md border border-unison-border bg-unison-bg-elevated p-0.5">
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
          <div className="rounded-lg border border-unison-border bg-unison-bg-elevated p-4">
            {variantQuery.isLoading || !variant ? (
              <LoadingPlaceholder rows={3} />
            ) : mode === "synced" ? (
              <LyricsRenderer
                variant={variant}
                currentTimeMs={currentTimeMs}
                playing={playing}
                onLineClick={handleLineClick}
              />
            ) : (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!canCopy}
                    aria-label="Copy lyrics body to clipboard"
                    aria-live="polite"
                    className={cn(
                      "rounded border border-unison-border px-2 py-1 text-xs transition-colors",
                      canCopy
                        ? "hover:border-unison-border-strong"
                        : "cursor-not-allowed text-unison-text-muted opacity-60",
                      canCopy && copyState === "idle" && "text-unison-text-secondary hover:text-unison-text",
                      canCopy && copyState === "copied" && "text-green-500",
                      canCopy && copyState === "failed" && "text-amber-500",
                    )}
                  >
                    {COPY_LABEL[copyState]}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-unison-text">
                  {variant.lyrics}
                </pre>
              </div>
            )}
          </div>
          <VariantList variants={variants} selectedId={selectedId ?? -1} onSelect={handleSelect} />
        </div>
      </div>
    </div>
  )
}
