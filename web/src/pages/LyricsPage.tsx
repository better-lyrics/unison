import { EmptyState } from "@/components/EmptyState"
import { LyricsContentSkeleton } from "@/components/LyricsRenderer"
import { LyricsPanel } from "@/components/LyricsPanel"
import { VariantList, VariantListSkeleton } from "@/components/VariantList"
import { VariantMetadata, VariantMetadataSkeleton } from "@/components/VariantMetadata"
import { SealLyricButton } from "@/components/council/SealLyricButton"
import { VoteControls } from "@/components/VoteControls"
import { YouTubeMusicIcon } from "@/components/icons/YouTubeMusicIcon"
import { Bone } from "@/components/skeleton"
import { useLyricsVariant, useLyricsVariants } from "@/hooks/useLyricsData"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { useCallback, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
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

  const variantsQuery = useLyricsVariants(safeVideoId)

  const variants = useMemo(() => variantsQuery.data?.variants ?? [], [variantsQuery.data])
  const requestedId = variantIdParam !== null ? Number(variantIdParam) : null
  const selectedId = useMemo(() => {
    if (requestedId !== null && variants.some((v) => v.id === requestedId)) return requestedId
    return variants[0]?.id
  }, [requestedId, variants])

  const variantQuery = useLyricsVariant(selectedId)

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

  if (!videoId) return <EmptyState title="No video specified" />

  if (variantsQuery.isLoading) return <LyricsPageSkeleton />
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
          <div className="flex items-center gap-3">
            <SealLyricButton videoId={safeVideoId} lyricsId={variant.id} />
            <VoteControls
              variantId={variant.id}
              videoId={safeVideoId}
              variant={{ score: variant.score, userVote: variant.userVote ?? null }}
            />
          </div>
        ) : (
          <Bone className="h-9 w-28 rounded-lg" />
        )}
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
          ) : (
            <VariantMetadataSkeleton />
          )}
          <a
            href={youTubeMusicUrl(safeVideoId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-[10px] bg-white/[0.08] px-4 py-3 text-[13px] font-semibold text-unison-text shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.07)] transition-colors hover:bg-white/[0.12] active:translate-y-px"
          >
            <YouTubeMusicIcon className="size-[18px]" />
            Open on YouTube Music
          </a>
        </div>
        <div className="space-y-4">
          <LyricsPanel
            variant={variantQuery.isLoading ? undefined : variant}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            onLineClick={handleLineClick}
          />
          <VariantList variants={variants} selectedId={selectedId ?? -1} onSelect={handleSelect} />
        </div>
      </div>
    </div>
  )
}

function LyricsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Bone className="h-4 w-12" />
        <Bone className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,384px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <VariantMetadataSkeleton />
          <Bone className="h-11 w-full rounded-[10px]" />
        </div>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-unison-border bg-unison-bg-elevated">
            <div className="flex items-center justify-between border-b border-unison-border/60 px-3 py-2">
              <Bone className="h-8 w-32 rounded-md" />
              <Bone className="h-7 w-36 rounded-md" />
            </div>
            <div className="p-4">
              <LyricsContentSkeleton />
            </div>
          </div>
          <VariantListSkeleton rows={4} />
        </div>
      </div>
    </div>
  )
}
