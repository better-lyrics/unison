import { EmptyState } from "@/components/EmptyState"
import { LyricsPanel, LyricsToolsSkeleton } from "@/components/LyricsPanel"
import { LyricsContentSkeleton } from "@/components/LyricsRenderer"
import { usePageArt } from "@/components/PageArt"
import { SongHero, SongHeroSkeleton } from "@/components/song/SongHero"
import { SongRail, SongRailSkeleton } from "@/components/song/SongRail"
import {
  type PreviewView,
  SuggestionNotice,
  SuggestionPreviewBar,
  SuggestionRail,
  SuggestionRailFold,
} from "@/components/song/SuggestionPreview"
import { useFillHeight } from "@/hooks/useFillHeight"
import { useLyricsVariant, useLyricsVariants, useRevisionDetail, useRevisionDiff } from "@/hooks/useLyricsData"
import { useActedOnSuggestion } from "@/hooks/useSuggestionMutations"
import { useSuggestionViewer } from "@/hooks/useSuggestionViewer"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { songBackdrop, useArtworkCover } from "@/lib/artwork"
import { type SuggestionContent, contentOf, isOwnerless, jumpTargets, previewActions } from "@/lib/lyric-suggestion"
import { syncTypeFor } from "@/lib/sync-type"
import { pushToast } from "@/lib/toast"
import type { VariantFull } from "@/lib/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"

const PAGE =
  "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-x-12 min-[1001px]:-mb-8 max-[1000px]:grid-cols-[minmax(0,1fr)] max-[1000px]:gap-y-7 max-[1000px]:pb-[88px]"
const STACKED_ONLY = "min-[1001px]:hidden"
const SIDE_BY_SIDE_ONLY = "max-[1000px]:hidden"
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

  const [toolsOverride, setToolsOverride] = useState<boolean | null>(null)
  const [toolsPlaying, setToolsPlaying] = useState(playing)
  if (toolsPlaying !== playing) {
    setToolsPlaying(playing)
    setToolsOverride(null)
  }
  const toolsOpen = toolsOverride ?? !playing
  const toggleTools = useCallback(() => setToolsOverride(!toolsOpen), [toolsOpen])

  const variantsQuery = useLyricsVariants(safeVideoId)

  const variants = useMemo(() => variantsQuery.data?.variants ?? [], [variantsQuery.data])
  const requestedId = variantIdParam !== null ? Number(variantIdParam) : null
  const selectedId = useMemo(() => {
    if (requestedId !== null && variants.some((v) => v.id === requestedId)) return requestedId
    return variants[0]?.id
  }, [requestedId, variants])

  const variantQuery = useLyricsVariant(selectedId)

  const { data: art, isPending: artPending } = useArtworkCover(safeVideoId)
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

  const loaded = variantQuery.data?.variant
  const variant = loaded && variants.some((v) => v.id === loaded.id) ? loaded : undefined
  const settled = variant !== undefined && variant.id === selectedId && !variantQuery.isPlaceholderData

  const viewer = useSuggestionViewer()
  const suggestionParam = params.get("suggestion")
  const waiting = variant?.revision?.suggestion
  const previewing = settled && waiting && suggestionParam === String(waiting.id) ? waiting : undefined
  const detail = useRevisionDetail(variant?.id ?? 0, previewing?.id ?? 0, previewing !== undefined)
  const diff = useRevisionDiff(variant?.id ?? 0, previewing?.id ?? 0, previewing !== undefined)
  const [liveFor, setLiveFor] = useState<number | null>(null)
  const jumps = useMemo(() => (diff.data ? jumpTargets(diff.data.rows) : undefined), [diff.data])

  const setSuggestionParam = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(params)
      if (id === null) next.delete("suggestion")
      else next.set("suggestion", String(id))
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const [checkedSince, setCheckedSince] = useState({ param: suggestionParam, at: Date.now() })
  if (checkedSince.param !== suggestionParam) setCheckedSince({ param: suggestionParam, at: Date.now() })
  const checkedFresh = variantQuery.dataUpdatedAt >= checkedSince.at
  const checkFailed = variantQuery.errorUpdatedAt >= checkedSince.at
  const { isFetching: variantFetching, refetch: refetchVariant } = variantQuery
  const recheck = suggestionParam !== null && settled && !previewing && !checkedFresh && !checkFailed
  useEffect(() => {
    if (recheck && !variantFetching) refetchVariant()
  }, [recheck, variantFetching, refetchVariant])

  const lost = suggestionParam !== null && settled && !previewing && checkedFresh
  const actedHere = useActedOnSuggestion(suggestionParam === null ? undefined : Number(suggestionParam))
  useEffect(() => {
    if (!lost) return
    if (!actedHere) {
      pushToast({ kind: "info", message: "That suggestion is no longer waiting", detail: "Showing the live version." })
    }
    setSuggestionParam(null)
  }, [lost, actedHere, setSuggestionParam])

  const content = contentOf(detail)
  const loadFailed = previewing !== undefined && content === "failed"
  const view: PreviewView = previewing && liveFor !== previewing.id && !loadFailed ? "suggestion" : "live"
  useEffect(() => {
    if (!loadFailed) return
    pushToast({
      kind: "error",
      message: "Could not load that suggestion",
      detail: "Check your connection and try again.",
    })
  }, [loadFailed])

  const shown = useMemo((): VariantFull | undefined => {
    if (!variant || !previewing || view === "live") return variant
    return detail.data ? { ...variant, lyrics: detail.data.lyrics, format: detail.data.format } : undefined
  }, [variant, previewing, view, detail.data])

  if (!videoId) return <EmptyState title="No video specified" />

  if (variantsQuery.isLoading) return <LyricsPageSkeleton lyricsRef={lyricsRef} />
  if (variantsQuery.isError) {
    const message = variantsQuery.error instanceof Error ? variantsQuery.error.message : "Unknown error"
    return <EmptyState title="Could not load lyrics" hint={message} />
  }
  if (variants.length === 0) {
    return <EmptyState title="No lyrics yet" hint="Request this song via the Better Lyrics extension." />
  }

  const now = Math.floor(Date.now() / 1000)
  const lyric = variant && {
    lyricsId: variant.id,
    videoId: variant.videoId,
    song: variant.song,
    artist: variant.artist,
  }
  const actionsFor = (suggestion: NonNullable<typeof waiting>, shownContent: SuggestionContent) =>
    previewActions(viewer, { submitterKeyId: variant?.submitter?.keyId ?? null, suggestion, content: shownContent })
  const unsynced = variant !== undefined && syncTypeFor(variant.syncType, variant.format) === "unsynced"
  const ownerSees = waiting && viewer && viewer.keyId === variant?.submitter?.keyId ? waiting : undefined

  let railTop = null
  if (previewing) {
    railTop = (
      <SuggestionRail
        suggestion={previewing}
        jumps={jumps}
        onJump={(jump) => handleLineClick(jump.seekSeconds)}
        unsynced={unsynced}
        className={SIDE_BY_SIDE_ONLY}
      />
    )
  } else if (ownerSees && settled) {
    railTop = (
      <SuggestionNotice
        suggestion={ownerSees}
        actions={actionsFor(ownerSees, "loaded")}
        now={now}
        onPreview={() => setSuggestionParam(ownerSees.id)}
      />
    )
  }

  return (
    <div className={PAGE}>
      {previewing && lyric && variant ? (
        <div className="t-reveal col-span-full mb-6">
          <SuggestionPreviewBar
            item={{ ...lyric, suggestion: previewing }}
            liveRevNo={variant.revision?.revNo ?? 1}
            actionsFor={(shownContent) => actionsFor(previewing, shownContent)}
            content={content}
            ownerless={isOwnerless(variant.submitter?.keyId)}
            view={view}
            onView={(next) => setLiveFor(next === "live" ? previewing.id : null)}
            onDone={() => setSuggestionParam(null)}
            now={now}
          />
          <SuggestionRailFold
            suggestion={previewing}
            jumps={jumps}
            onJump={(jump) => handleLineClick(jump.seekSeconds)}
            unsynced={unsynced}
            className={STACKED_ONLY}
          />
        </div>
      ) : null}
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
            variant={variantQuery.isLoading ? undefined : shown}
            contentKey={previewing ? view : undefined}
            fileTools={view === "live" || !previewing}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            toolsOpen={toolsOpen}
            onLineClick={handleLineClick}
            lyricsClassName={LYRICS_SIZE}
          />
        </div>
      </div>
      <SongRail
        variant={variant}
        variants={variants}
        selectedId={selectedId ?? -1}
        onSelect={handleSelect}
        top={railTop}
      />
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
