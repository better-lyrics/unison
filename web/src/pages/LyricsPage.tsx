import { ArtBackground } from "@/components/ArtBackground"
import { EmptyState } from "@/components/EmptyState"
import { LyricsContentSkeleton } from "@/components/LyricsRenderer"
import { LyricsPanel } from "@/components/LyricsPanel"
import { SongHero, SongHeroSkeleton } from "@/components/song/SongHero"
import { SongRail } from "@/components/song/SongRail"
import { Bone } from "@/components/skeleton"
import { useArtPalette } from "@/hooks/useArtPalette"
import { useLyricsVariant, useLyricsVariants } from "@/hooks/useLyricsData"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { useArtwork } from "@/lib/artwork"
import { sleeveDataUrl } from "@/lib/sleeve"
import { useCallback, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"

const PAGE = "[text-shadow:0_1px_16px_rgba(0,0,0,0.3)]"
const BODY =
  "grid grid-cols-[minmax(0,1fr)_340px] gap-12 pt-2 pb-[88px] max-[1000px]:grid-cols-[minmax(0,1fr)] max-[1000px]:gap-7 max-[1000px]:pt-0"
const LYRICS_SIZE = "h-[560px] max-w-none max-[1000px]:h-[440px]"
const SLEEVE_SIZE = 630

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
  const [playerActive, setPlayerActive] = useState(false)
  const variantIdParam = params.get("variantId")

  const safeVideoId = videoId ?? ""
  const { ref, getCurrentTime, getPlaying, playing, seekTo, play, pause } = useYouTubePlayer(
    safeVideoId.length > 0 ? safeVideoId : null,
    { playerVars: { autoplay: 1 } },
  )

  const [playerVideoId, setPlayerVideoId] = useState(safeVideoId)
  if (safeVideoId !== playerVideoId) {
    setPlayerVideoId(safeVideoId)
    setPlayerActive(false)
  }

  const togglePlay = useCallback(() => {
    if (!playerActive) setPlayerActive(true)
    else if (getPlaying()) pause()
    else play()
  }, [playerActive, getPlaying, pause, play])

  const variantsQuery = useLyricsVariants(safeVideoId)

  const variants = useMemo(() => variantsQuery.data?.variants ?? [], [variantsQuery.data])
  const requestedId = variantIdParam !== null ? Number(variantIdParam) : null
  const selectedId = useMemo(() => {
    if (requestedId !== null && variants.some((v) => v.id === requestedId)) return requestedId
    return variants[0]?.id
  }, [requestedId, variants])

  const variantQuery = useLyricsVariant(selectedId)

  const { data: art, isPending: artPending } = useArtwork(safeVideoId)
  const lead = variants[0]
  const sleeve = useMemo(() => (lead ? sleeveDataUrl(lead.song, lead.artist, SLEEVE_SIZE) : null), [lead])
  const backdrop = art ?? (artPending ? null : sleeve)
  useArtPalette(backdrop)

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
    <div className={PAGE}>
      <ArtBackground src={backdrop} />
      {variant ? (
        <SongHero
          variant={variant}
          versions={variants.length}
          art={art}
          player={{ ref, active: playerActive, playing, onToggle: togglePlay }}
        />
      ) : (
        <SongHeroSkeleton />
      )}
      <div className={BODY}>
        <div className="lyrics-view min-w-0">
          <LyricsPanel
            variant={variantQuery.isLoading ? undefined : variant}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            onLineClick={handleLineClick}
            lyricsClassName={LYRICS_SIZE}
          />
        </div>
        <SongRail variant={variant} variants={variants} selectedId={selectedId ?? -1} onSelect={handleSelect} />
      </div>
    </div>
  )
}

function LyricsPageSkeleton() {
  return (
    <div className={PAGE}>
      <SongHeroSkeleton />
      <div className={BODY}>
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5">
            <Bone className="h-9 w-[124px] rounded-full" />
            <Bone className="ml-auto h-9 w-48 rounded-full" />
          </div>
          <LyricsContentSkeleton className={LYRICS_SIZE} />
        </div>
        <div className="flex flex-col gap-4">
          <Bone className="h-[150px] rounded-[22px]" />
          <Bone className="h-[130px] rounded-[22px]" />
        </div>
      </div>
    </div>
  )
}
