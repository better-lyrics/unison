import { usePageArt } from "@/components/PageArt"
import { EmptyState } from "@/components/EmptyState"
import { LyricsContentSkeleton } from "@/components/LyricsRenderer"
import { LyricsPanel, LyricsToolsSkeleton } from "@/components/LyricsPanel"
import { SongHero, SongHeroSkeleton } from "@/components/song/SongHero"
import { SongRail, SongRailSkeleton } from "@/components/song/SongRail"
import { useFillHeight } from "@/hooks/useFillHeight"
import { useLyricsVariant, useLyricsVariants } from "@/hooks/useLyricsData"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { songBackdrop, useArtwork } from "@/lib/artwork"
import { useCallback, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"

const PAGE =
  "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-x-12 min-[1001px]:-mb-8 max-[1000px]:grid-cols-[minmax(0,1fr)] max-[1000px]:gap-y-7 max-[1000px]:pb-[88px]"
const LYRICS_FILL = "lyrics-fill"
const LYRICS_SIZE = `${LYRICS_FILL} h-[max(var(--fill-height,560px),240px)] max-w-none max-[1000px]:h-[70dvh]`

export function LyricsPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [params, setParams] = useSearchParams()
  const [playerActive, setPlayerActive] = useState(false)
  const variantIdParam = params.get("variantId")
  const lyricsRef = useFillHeight(`.${LYRICS_FILL}`)

  const safeVideoId = videoId ?? ""
  const { ref, getCurrentTime, getPlaying, playing, ready, failed, seekTo, play, pause } = useYouTubePlayer(
    safeVideoId.length > 0 ? safeVideoId : null,
    { playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1 } },
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

  const [toolsOverride, setToolsOverride] = useState<{ playing: boolean; open: boolean } | null>(null)
  const toolsOpen = toolsOverride?.playing === playing ? toolsOverride.open : !playing
  const toggleTools = useCallback(() => setToolsOverride({ playing, open: !toolsOpen }), [playing, toolsOpen])

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
  const backdrop = useMemo(
    () => (artPending || !lead ? null : songBackdrop(safeVideoId, Boolean(art), lead.song, lead.artist)),
    [artPending, lead, art, safeVideoId],
  )
  usePageArt(backdrop, playing)

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

  if (variantsQuery.isLoading) return <LyricsPageSkeleton lyricsRef={lyricsRef} />
  if (variantsQuery.isError) {
    const message = variantsQuery.error instanceof Error ? variantsQuery.error.message : "Unknown error"
    return <EmptyState title="Could not load lyrics" hint={message} />
  }
  if (variants.length === 0) {
    return <EmptyState title="No lyrics yet" hint="Request this song via the Better Lyrics extension." />
  }

  const loaded = variantQuery.data?.variant
  const variant = loaded && variants.some((v) => v.id === loaded.id) ? loaded : undefined

  return (
    <div className={PAGE}>
      <div className="min-w-0">
        {variant ? (
          <SongHero
            variant={variant}
            versions={variants.length}
            art={art}
            player={{ ref, active: playerActive, playing, ready, failed, onToggle: togglePlay }}
            lyricsTools={{ open: toolsOpen, onToggle: toggleTools }}
          />
        ) : (
          <SongHeroSkeleton title={lead?.song} />
        )}
        <div ref={lyricsRef} className="lyrics-view">
          <LyricsPanel
            variant={variantQuery.isLoading ? undefined : variant}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            playing={playing}
            toolsOpen={toolsOpen}
            onLineClick={handleLineClick}
            lyricsClassName={LYRICS_SIZE}
          />
        </div>
      </div>
      <SongRail variant={variant} variants={variants} selectedId={selectedId ?? -1} onSelect={handleSelect} />
    </div>
  )
}

function LyricsPageSkeleton({ lyricsRef }: { lyricsRef: (node: HTMLElement | null) => void }) {
  return (
    <div className={PAGE}>
      <div className="min-w-0">
        <SongHeroSkeleton />
        <div ref={lyricsRef} className="lyrics-view">
          <LyricsToolsSkeleton />
          <LyricsContentSkeleton className={LYRICS_SIZE} />
        </div>
      </div>
      <SongRailSkeleton />
    </div>
  )
}
