import { CoverImage } from "@/components/AlbumArt"
import { SwapLabel } from "@/components/SwapLabel"
import { SyncTag } from "@/components/SyncTag"
import { Tooltip } from "@/components/Tooltip"
import { VoteControls } from "@/components/VoteControls"
import { EditMetadataButton } from "@/components/council/EditMetadataButton"
import { SealLyricButton } from "@/components/council/SealLyricButton"
import { IconSwap } from "@/components/icons/IconSwap"
import { PlayPauseIcon } from "@/components/icons/PlaybackIcons"
import { YouTubeMusicIcon } from "@/components/icons/YouTubeMusicIcon"
import { Bone } from "@/components/skeleton"
import { chipClass, chipIconClass, glassClass, raisedChipClass } from "@/components/ui"
import { useCopied } from "@/hooks/useCopied"
import { cn } from "@/lib/cn"
import { titleCase } from "@/lib/format"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import { languageName } from "@/lib/language"
import { type SyncKind, syncTypeFor } from "@/lib/sync-type"
import type { Mark, VariantFull } from "@/lib/types"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconCheck, IconShare } from "@tabler/icons-react"
import { motion } from "motion/react"

const SYNC_TIP: Record<SyncKind, string> = {
  syllable: "Syllable synced: each syllable highlights as it is sung.",
  word: "Word synced: each word highlights as it is sung.",
  line: "Line synced: each line highlights as it is sung.",
  unsynced: "Plain text with no timing.",
}

const CONFIDENCE_TIP = "How sure we are this is the best version, from vote volume and rater agreement."

const TITLE_SIZE = {
  l: "text-[44px] max-[1000px]:text-[34px] max-sm:text-[28px]",
  m: "text-[40px] max-[1000px]:text-[30px] max-sm:text-[25px]",
  s: "text-[34px] max-[1000px]:text-[26px] max-sm:text-[22px]",
}

const TAG_PILL = cn(
  glassClass,
  "inline-flex h-[30px] cursor-default select-none items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium text-(--ink-2) [corner-shape:superellipse(1.6)]",
)

const PLAY_CIRCLE = cn(
  glassClass,
  "grid size-12 cursor-pointer place-items-center rounded-full bg-[rgba(15,14,19,0.45)] text-unison-text backdrop-blur-[12px] transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]",
)

export const HERO_GRID =
  "grid grid-cols-[168px_minmax(0,1fr)] items-center gap-7 pb-8 max-[1000px]:grid-cols-[128px_minmax(0,1fr)] max-[1000px]:gap-5 max-sm:grid-cols-[88px_minmax(0,1fr)] max-sm:gap-x-4 max-sm:gap-y-0 max-sm:pb-6"

export const HERO_ART = "w-full max-sm:row-span-2 max-sm:self-center"

const COVER_FRAME =
  "group relative aspect-square w-full overflow-hidden rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.35),0_6px_18px_rgba(0,0,0,0.25)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:outline after:outline-1 after:-outline-offset-1 after:outline-white/10"

function titleSize(title: string): keyof typeof TITLE_SIZE {
  if (title.length <= 14) return "l"
  return title.length <= 24 ? "m" : "s"
}

export interface HeroPlayer {
  ref: (node: HTMLDivElement | null) => void
  active: boolean
  playing: boolean
  ready: boolean
  failed: boolean
  onToggle: () => void
}

interface SongHeroProps {
  variant: VariantFull
  versions: number
  art: string | null | undefined
  player: HeroPlayer
}

function Cover({ variant, art, player }: Omit<SongHeroProps, "versions">) {
  const label = player.playing ? "Pause" : "Play"
  const covered = !(player.active && (player.playing || player.failed))
  return (
    <div className={COVER_FRAME}>
      {player.active ? (
        <div inert className="pointer-events-none absolute inset-0 bg-black">
          <div ref={player.ref} className="size-full" />
        </div>
      ) : null}
      <div
        aria-hidden={!covered}
        className={cn(
          "absolute inset-0 transition-[opacity,filter] duration-(--reveal-dur) ease-in-out motion-reduce:transition-none",
          !covered && "pointer-events-none opacity-0 blur-(--reveal-blur)",
        )}
      >
        <CoverImage src={art} song={variant.song} artist={variant.artist} />
      </div>
      {player.active ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <button
            type="button"
            onClick={player.onToggle}
            aria-label={label}
            className={cn(
              PLAY_CIRCLE,
              "opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
            )}
          >
            <PlayPauseIcon playing={player.playing} className="size-5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={player.onToggle}
          aria-label={`Play ${variant.song}`}
          className="group/play absolute inset-0 grid cursor-pointer place-items-center"
        >
          <span
            className={cn(
              PLAY_CIRCLE,
              "opacity-0 group-hover:opacity-100 group-focus-visible/play:opacity-100 group-active/play:scale-[0.96]",
            )}
          >
            <PlayPauseIcon playing={false} className="size-5" />
          </span>
        </button>
      )}
    </div>
  )
}

function SealStamp({ seal }: { seal: Mark }) {
  const label = seal.by ? `Council sealed by ${seal.by.displayName}` : seal.label
  return (
    <Tooltip label={label}>
      <img
        src={seal.icon}
        alt={label}
        className="ml-[0.18em] inline-block size-[0.6em] -rotate-9 align-baseline drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]"
      />
    </Tooltip>
  )
}

function ShareButton({ videoId }: { videoId: string }) {
  const [copied, copy] = useCopied()
  return (
    <Tooltip label={copied ? "Link copied" : "Copy link"}>
      <button
        type="button"
        aria-label={copied ? "Link copied" : "Share"}
        onClick={() => copy(`${window.location.origin}/song/${videoId}`)}
        className={cn(chipClass, "w-[30px] justify-center px-0")}
      >
        <IconSwap
          swapped={copied}
          from={<IconShare className="size-full" stroke={1.75} />}
          to={<IconCheck className="size-full" stroke={1.75} />}
          className={chipIconClass}
        />
      </button>
    </Tooltip>
  )
}

export function SongHero({ variant, versions, art, player }: SongHeroProps) {
  const sync = syncTypeFor(variant.syncType, variant.format)
  const seal = variant.marks?.find((mark) => mark.type === "seal")
  return (
    <section className={cn(HERO_GRID, "t-reveal")}>
      <div className={HERO_ART}>
        <Cover variant={variant} art={art} player={player} />
      </div>
      <div className="min-w-0 max-sm:contents">
        <div className={cn(TITLE_SIZE[titleSize(variant.song)], "max-sm:self-end")}>
          <h1
            title={variant.song}
            className="-mr-[0.08em] -mb-[0.08em] line-clamp-2 pr-[0.08em] pb-[0.08em] font-black leading-[1.08] tracking-[-0.035em] text-balance"
          >
            {variant.song}
            {seal ? <SealStamp seal={seal} /> : null}
          </h1>
        </div>
        <p
          title={variant.album ? `${variant.artist} · ${variant.album}` : variant.artist}
          className="mt-1.5 -mb-[0.16em] flex min-w-0 whitespace-nowrap max-sm:self-start pr-[0.08em] pb-[0.16em] text-[17px] font-medium max-[1000px]:text-[15px]"
        >
          <span className="max-w-full shrink-0 truncate text-(--ink-2)">{variant.artist}</span>
          {variant.album ? <span className="min-w-[3ch] truncate text-(--ink-3)">{` · ${variant.album}`}</span> : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 [text-shadow:none] max-sm:col-span-2 max-sm:mt-4">
          <Tooltip label={SYNC_TIP[sync]}>
            <span className="inline-flex">
              <SyncTag kind={sync} size="tag" />
            </span>
          </Tooltip>
          {versions > 1 ? (
            <span className={TAG_PILL}>
              <b className="font-bold text-unison-text">{versions}</b> versions
            </span>
          ) : null}
          {variant.language ? <span className={TAG_PILL}>{languageName(variant.language)}</span> : null}
          <Tooltip label={CONFIDENCE_TIP}>
            <span className={TAG_PILL}>{`${titleCase(variant.confidence)} confidence`}</span>
          </Tooltip>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 [text-shadow:none] max-sm:col-span-2 max-sm:mt-3">
          <motion.button
            layout
            type="button"
            onClick={player.onToggle}
            transition={{ layout: LAYOUT_TRANSITION }}
            style={{ borderRadius: 10 }}
            className={cn(
              raisedChipClass,
              "shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_rgba(18,17,22,0.14)] max-sm:flex-1 max-sm:justify-center",
            )}
          >
            <motion.span layout className="inline-flex">
              <PlayPauseIcon playing={player.playing} className={chipIconClass} />
            </motion.span>
            <SwapLabel text={player.playing ? "Pause" : "Play"} />
          </motion.button>
          <a
            href={youTubeMusicUrl(variant.videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(chipClass, "max-sm:flex-1 max-sm:justify-center")}
          >
            <YouTubeMusicIcon className={chipIconClass} />
            YouTube Music
          </a>
          <span aria-hidden="true" className="hidden basis-full max-sm:block" />
          <VoteControls
            variantId={variant.id}
            videoId={variant.videoId}
            variant={{ score: variant.score, userVote: variant.userVote ?? null }}
            beforeReport={<ShareButton videoId={variant.videoId} />}
          />
          <div className="flex items-center gap-2 before:mr-1 before:h-5 before:w-px before:bg-white/[0.14] empty:hidden">
            <EditMetadataButton
              videoId={variant.videoId}
              lyricsId={variant.id}
              current={{ song: variant.song, artist: variant.artist, album: variant.album ?? null }}
            />
            <SealLyricButton videoId={variant.videoId} lyricsId={variant.id} />
          </div>
        </div>
        {variant.hidden ? (
          <p className="mt-4 text-[13px] font-medium text-unison-warn max-sm:col-span-2">
            This variant has been auto-hidden by community downvotes.
          </p>
        ) : null}
      </div>
    </section>
  )
}

export function SongHeroSkeleton() {
  return (
    <section data-testid="song-hero-skeleton" className={HERO_GRID}>
      <div className={HERO_ART}>
        <Bone className="aspect-square w-full rounded-2xl" />
      </div>
      <div className="min-w-0 max-sm:contents">
        <div className={cn(TITLE_SIZE.l, "flex h-[1.08em] items-center max-sm:self-end")}>
          <Bone className="h-[0.72em] w-1/2 rounded-lg" />
        </div>
        <div className="mt-1.5 flex h-[26px] items-center max-[1000px]:h-[23px] max-sm:self-start">
          <Bone className="h-3.5 w-1/4" />
        </div>
        <div className="mt-3 flex gap-2 max-sm:col-span-2 max-sm:mt-4">
          <Bone className="h-[30px] w-[93px] rounded-[10px]" />
          <Bone className="h-[30px] w-[66px] rounded-[10px]" />
          <Bone className="h-[30px] w-[117px] rounded-[10px]" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 max-sm:col-span-2 max-sm:mt-3">
          <Bone className="h-[30px] w-[69px] rounded-[10px]" />
          <Bone className="h-[30px] w-[131px] rounded-[10px]" />
          <Bone className="h-[30px] w-[86px] rounded-[10px]" />
          <Bone className="size-[30px] rounded-[10px]" />
          <Bone className="size-[30px] rounded-[10px]" />
        </div>
      </div>
    </section>
  )
}
