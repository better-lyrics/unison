import { IconPlayerPlayFilled } from "@tabler/icons-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { Link } from "react-router-dom"
import { useBadgeCatalogueOptional } from "@/components/BadgeCatalogueContext"
import { TierChip } from "@/components/TierChip"
import { Tooltip } from "@/components/Tooltip"
import { useArtwork, youtubeThumbnailFallbackUrl, youtubeThumbnailUrl } from "@/lib/artwork"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { resolveBadgeImage } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import type { Mark, VariantFull } from "@/lib/types"

const SYNC_TIP: Record<string, string> = {
  richsync: "Word-by-word synced lyrics that highlight as the song plays.",
  linesync: "Line-by-line synced lyrics.",
  plain: "Plain text with no timing.",
}
const FORMAT_TIP: Record<string, string> = {
  ttml: "TTML: rich timed-text lyrics format.",
  lrc: "LRC: standard timed-lyrics format.",
  plain: "Plain text, no timing.",
}
const CONFIDENCE_TIP = (c: string) =>
  `Confidence ${c}: how sure we are this is the best version, from vote volume and rater agreement.`
const SCORE_TIP =
  "Ranking score, weighted by each voter's reputation. Higher shows first. Raw net votes in parentheses."
const VOTES_TIP = "How many people have voted on this version."
const REP_TIP = "Submitter reputation (0 to 2). Trusted users' votes and submissions count for more."

function langName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

function truncateKey(keyId: string): string {
  return keyId.length <= 12 ? keyId : `${keyId.slice(0, 8)}…${keyId.slice(-4)}`
}

function TrackHeading({ variant }: { variant: VariantFull }) {
  return (
    <div>
      <div className="truncate text-[20px] font-bold leading-tight tracking-[-0.01em] text-unison-text">
        {variant.song}
      </div>
      <div className="mt-0.5 flex min-w-0 items-baseline text-[13px]">
        <span className="min-w-0 flex-[0_1_auto] truncate text-unison-text-secondary">{variant.artist}</span>
        {variant.album ? (
          <>
            <span className="mx-1.5 shrink-0 text-unison-text-muted">·</span>
            <span className="min-w-0 flex-[0_1_auto] truncate text-unison-text-muted">{variant.album}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface CoverProps {
  variant: VariantFull
  playerRef?: (node: HTMLDivElement | null) => void
  playerActive?: boolean
  onActivatePlayer?: () => void
}

function Cover({ variant, playerRef, playerActive, onActivatePlayer }: CoverProps) {
  const { data: art } = useArtwork(variant.videoId)

  if (playerActive) {
    return (
      <div className="aspect-square w-full overflow-hidden bg-black">
        <div ref={playerRef} className="size-full" />
      </div>
    )
  }

  const src = art ?? youtubeThumbnailUrl(variant.videoId)
  const poster = (
    <>
      <img
        src={src}
        alt=""
        onError={(e) => {
          if (!art) e.currentTarget.src = youtubeThumbnailFallbackUrl(variant.videoId)
        }}
        className="block size-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_28%,rgba(19,18,23,0.82)_64%,var(--color-unison-bg-elevated)_100%)]" />
      {onActivatePlayer ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors group-hover:bg-black/70">
            <IconPlayerPlayFilled className="size-6 translate-x-px" />
          </span>
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-x-4 bottom-3.5">
        <TrackHeading variant={variant} />
      </div>
    </>
  )

  if (onActivatePlayer) {
    return (
      <button
        type="button"
        onClick={onActivatePlayer}
        aria-label={`Play ${variant.song}`}
        className="group relative block aspect-square w-full cursor-pointer text-left"
      >
        {poster}
      </button>
    )
  }
  return <div className="relative aspect-square w-full">{poster}</div>
}

function Pill({ tip, gold, children }: { tip: string; gold?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip label={tip}>
      <span
        className={cn(
          "inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold leading-none",
          gold
            ? "border-unison-medal-gold/35 bg-unison-medal-gold/10 text-unison-medal-gold"
            : "border-unison-border bg-white/[0.03] text-unison-text-secondary",
        )}
      >
        {children}
      </span>
    </Tooltip>
  )
}

function SubmitterRow({ variant }: { variant: VariantFull }) {
  const s = variant.submitter
  const catalogue = useBadgeCatalogueOptional()
  const cat = catalogue?.status === "success" ? catalogue.data : null
  const badgeImage = (key: string, tier?: number) => {
    const def = cat?.badges.find((d) => d.key === key)
    return def ? resolveBadgeImage(def, tier, "color") : null
  }
  if (!s) return null
  const gemSrc = s.tier ? badgeImage(s.tier) : null
  const featured = s.featured ?? []
  const topBadgeSrc = s.topBadge ? badgeImage(s.topBadge.key, s.topBadge.tier) : null
  const extra = s.badgeCount - 1

  return (
    <Link to={`/curator/${s.keyId}`} className="flex cursor-pointer flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <img
          src={dicebearThumbsDataUri(s.keyId)}
          alt=""
          className="size-10 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-unison-text">{s.displayName}</div>
          <div className="truncate font-mono text-[11px] text-unison-text-muted">{truncateKey(s.keyId)}</div>
        </div>
        <Tooltip label={REP_TIP}>
          <span className="shrink-0 rounded-full bg-unison-medal-gold/12 px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums text-unison-medal-gold">
            {s.reputation.toFixed(1)}
          </span>
        </Tooltip>
      </div>
      {s.tier || featured.length > 0 || topBadgeSrc ? (
        <div className="flex flex-wrap items-center gap-2">
          {s.tier ? <TierChip tier={s.tier} gemSrc={gemSrc ?? undefined} /> : null}
          {featured.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              {featured.map((b) => {
                const img = badgeImage(b.key, b.tier)
                return img ? (
                  <img key={b.key} src={img} alt={b.name} title={b.name} className="size-5 object-contain" />
                ) : null
              })}
            </span>
          ) : topBadgeSrc ? (
            <span className="inline-flex items-center gap-1.5">
              <img src={topBadgeSrc} alt={s.topBadge?.name ?? ""} className="size-5" />
              {extra > 0 ? (
                <span className="font-mono text-[11px] font-semibold text-unison-text-muted">+{extra}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  )
}

function MarkCallout({ mark }: { mark: Mark }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg bg-white/10 pr-2.5">
        <img src={mark.icon} alt="" className="size-6 shrink-0 object-contain [transform:scale(1.05)_rotate(-6deg)]" />
        <span className="text-xs font-medium leading-tight text-white">{mark.label}</span>
      </span>
      {mark.by ? (
        <span className="text-[11px] text-unison-text-muted">
          by{" "}
          <Link
            to={`/curator/${mark.by.keyId}`}
            className="text-unison-text-secondary underline-offset-2 hover:underline"
          >
            {mark.by.displayName}
          </Link>
        </span>
      ) : null}
    </div>
  )
}

interface VariantMetadataProps {
  variant: VariantFull
  playerRef?: (node: HTMLDivElement | null) => void
  playerActive?: boolean
  onActivatePlayer?: () => void
}

export function VariantMetadata({ variant, playerRef, playerActive, onActivatePlayer }: VariantMetadataProps) {
  return (
    <aside className="overflow-hidden rounded-xl border border-unison-border bg-unison-bg-elevated">
      <Cover variant={variant} playerRef={playerRef} playerActive={playerActive} onActivatePlayer={onActivatePlayer} />
      <div
        className={cn(
          "border-t px-4 pt-1.5 pb-4 transition-colors duration-300",
          playerActive ? "border-unison-border" : "border-transparent",
        )}
      >
        <MotionConfig reducedMotion="user">
          <AnimatePresence>
            {playerActive ? (
              <motion.div
                key="track-heading"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={LAYOUT_TRANSITION}
                className="overflow-hidden"
              >
                <div className="pt-2.5 pb-3.5">
                  <TrackHeading variant={variant} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </MotionConfig>
        <div className="space-y-3.5">
          {variant.hidden ? (
            <div className="rounded-lg border border-unison-warn/40 bg-unison-warn/10 px-2.5 py-2 text-[11.5px] font-medium text-unison-warn">
              This variant has been auto-hidden by community downvotes.
            </div>
          ) : null}
          {variant.marks?.map((mark) => (
            <MarkCallout key={`${mark.type}:${mark.at ?? mark.label}`} mark={mark} />
          ))}
          <div className="flex flex-wrap gap-1.5">
            <Pill tip={SYNC_TIP[variant.syncType] ?? variant.syncType} gold={variant.syncType === "richsync"}>
              {variant.syncType}
            </Pill>
            <Pill tip={FORMAT_TIP[variant.format] ?? variant.format}>{variant.format.toUpperCase()}</Pill>
            {variant.language ? (
              <Pill tip={`Lyrics language: ${langName(variant.language)}.`}>{variant.language.toUpperCase()}</Pill>
            ) : null}
            <Pill tip={CONFIDENCE_TIP(variant.confidence)}>{variant.confidence}</Pill>
          </div>
          <div className="h-px bg-unison-border" />
          <div className="flex items-end gap-5">
            <Tooltip label={SCORE_TIP}>
              <div className="cursor-default">
                <div className="font-mono text-[21px] font-bold leading-none tabular-nums">
                  {variant.effectiveScore.toFixed(1)}
                  <span className="ml-1 text-xs font-semibold text-unison-text-muted">{`(${variant.score})`}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-unison-text-muted">Score</div>
              </div>
            </Tooltip>
            <div className="w-px self-stretch bg-unison-border" />
            <Tooltip label={VOTES_TIP}>
              <div className="cursor-default">
                <div className="font-mono text-[21px] font-bold leading-none tabular-nums">{variant.voteCount}</div>
                <div className="mt-1 text-[11.5px] text-unison-text-muted">Votes</div>
              </div>
            </Tooltip>
          </div>
          {variant.isrc ? (
            <>
              <div className="h-px bg-unison-border" />
              <div className="flex justify-between gap-2.5 text-[11.5px] text-unison-text-muted">
                <span>ISRC</span>
                <span className="truncate font-mono text-unison-text-secondary">{variant.isrc}</span>
              </div>
            </>
          ) : null}
          {variant.submitter ? (
            <>
              <div className="h-px bg-unison-border" />
              <SubmitterRow variant={variant} />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
