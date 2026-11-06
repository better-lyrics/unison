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
import { glassActionClass, glassClass } from "@/components/ui"
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
  l: "text-[72px] max-[1000px]:text-[46px]",
  m: "text-[62px] max-[1000px]:text-[40px]",
  s: "text-[50px] max-[1000px]:text-[34px]",
}

const TAG_PILL = cn(
  glassClass,
  "inline-flex h-8 cursor-default items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium text-(--ink-2) [corner-shape:superellipse(1.6)]",
)

const PLAY_CIRCLE = cn(
  glassClass,
  "grid size-16 cursor-pointer place-items-center rounded-full bg-[rgba(15,14,19,0.45)] text-unison-text backdrop-blur-[12px] transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]",
)

export const HERO_GRID =
  "grid grid-cols-[320px_minmax(0,1fr)] items-end gap-12 pt-2 pb-10 max-[1000px]:grid-cols-1 max-[1000px]:gap-7 max-[1000px]:pt-0 max-[1000px]:pb-7"

export const HERO_ART = "w-full max-[1000px]:w-[min(260px,70vw)] max-sm:w-full"

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
  return (
    <div className={COVER_FRAME}>
      {player.active ? (
        <div ref={player.ref} className="size-full bg-black" />
      ) : (
        <CoverImage src={art} song={variant.song} artist={variant.artist} />
      )}
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
            <PlayPauseIcon playing={player.playing} className="size-[26px]" />
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
            <PlayPauseIcon playing={false} className="size-[26px]" />
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
        className={cn(glassActionClass, "w-11 px-0")}
      >
        <IconSwap
          swapped={copied}
          from={<IconShare className="size-full" stroke={1.75} />}
          to={<IconCheck className="size-full" stroke={1.75} />}
          className="size-[18px]"
        />
      </button>
    </Tooltip>
  )
}

export function SongHero({ variant, versions, art, player }: SongHeroProps) {
  const sync = syncTypeFor(variant.syncType, variant.format)
  const seal = variant.marks?.find((mark) => mark.type === "seal")
  return (
    <section className={HERO_GRID}>
      <div className={HERO_ART}>
        <Cover variant={variant} art={art} player={player} />
      </div>
      <div className="min-w-0">
        <div className={TITLE_SIZE[titleSize(variant.song)]}>
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
          className="mt-3 -mb-[0.16em] flex min-w-0 whitespace-nowrap pr-[0.08em] pb-[0.16em] text-xl font-medium max-[1000px]:text-[17px]"
        >
          <span className="max-w-full shrink-0 truncate text-(--ink-2)">{variant.artist}</span>
          {variant.album ? <span className="min-w-[3ch] truncate text-(--ink-3)">{` · ${variant.album}`}</span> : null}
        </p>
        <div className="mt-[22px] flex flex-wrap gap-2 [text-shadow:none]">
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
        <div className="mt-[26px] flex flex-wrap items-center gap-2 [text-shadow:none]">
          <motion.button
            layout
            type="button"
            onClick={player.onToggle}
            transition={{ layout: LAYOUT_TRANSITION }}
            style={{ borderRadius: 9999 }}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-unison-text pr-[18px] pl-4 max-sm:flex-1 text-sm font-bold text-[#121116] transition-[background-color,scale] duration-150 ease-out hover:bg-white active:scale-[0.96]"
          >
            <motion.span layout className="inline-flex">
              <PlayPauseIcon playing={player.playing} />
            </motion.span>
            <SwapLabel text={player.playing ? "Pause" : "Play"} />
          </motion.button>
          <a
            href={youTubeMusicUrl(variant.videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(glassActionClass, "pl-4 max-sm:flex-1 max-sm:justify-center")}
          >
            <YouTubeMusicIcon className="size-[18px]" />
            YouTube Music
          </a>
          <span aria-hidden="true" className="hidden basis-full max-sm:block" />
          <VoteControls
            variantId={variant.id}
            videoId={variant.videoId}
            variant={{ score: variant.score, userVote: variant.userVote ?? null }}
            beforeReport={<ShareButton videoId={variant.videoId} />}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 [text-shadow:none] empty:hidden">
          <EditMetadataButton
            videoId={variant.videoId}
            lyricsId={variant.id}
            current={{ song: variant.song, artist: variant.artist, album: variant.album ?? null }}
          />
          <SealLyricButton videoId={variant.videoId} lyricsId={variant.id} />
        </div>
        {variant.hidden ? (
          <p className="mt-4 text-[13px] font-medium text-unison-warn">
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
      <div className="min-w-0">
        <Bone className="h-16 w-3/4 rounded-xl max-[1000px]:h-11" />
        <Bone className="mt-4 h-6 w-1/3" />
        <div className="mt-[22px] flex gap-2">
          <Bone className="h-8 w-24 rounded-[10px]" />
          <Bone className="h-8 w-20 rounded-[10px]" />
          <Bone className="h-8 w-32 rounded-[10px]" />
        </div>
        <div className="mt-[26px] flex gap-2">
          <Bone className="h-11 w-24 rounded-full" />
          <Bone className="h-11 w-40 rounded-full" />
          <Bone className="h-11 w-28 rounded-full" />
        </div>
      </div>
    </section>
  )
}
