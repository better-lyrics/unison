import { OdometerNumber } from "@/components/OdometerNumber"
import { SwapLabel } from "@/components/SwapLabel"
import { DiscordIcon } from "@/components/icons/DiscordIcon"
import { IconSwap } from "@/components/icons/IconSwap"
import { DiscordChip } from "@/components/profile/DiscordChip"
import { chipClass, chipIconClass, raisedChipClass } from "@/components/ui"
import { useCopied } from "@/hooks/useCopied"
import { plural } from "@/lib/format"
import { levelProgress } from "@/lib/level"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import type { UserGamification, UserRankResponse } from "@/lib/types"
import { IconCheck, IconDownload, IconPencil, IconShare } from "@tabler/icons-react"
import { motion } from "motion/react"

interface ProfileSideProps {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
  owner: boolean
  onEditProfile: () => void
  onConnectDiscord?: () => void
}

function profileUrl(handle: string | null | undefined, keyId: string): string {
  return `${window.location.origin}${handle ? `/u/${handle}` : `/curator/${keyId}`}`
}

function standingText(rank: UserRankResponse): string {
  if (rank.community) return "The shared community account."
  return rank.ranked ? `Ranked #${rank.rank} among Unison curators.` : "Not ranked yet."
}

function Lede({ rank }: { rank: UserRankResponse }) {
  const synced = rank.ranked ? rank.submissionCount : 0
  return (
    <p className="m-0 text-[40px] font-black leading-[1.08] tracking-[-0.03em] text-balance max-[1000px]:text-[30px]">
      {synced > 0 ? `${plural(synced, "song", "songs")} synced. ` : "New curator. "}
      <span className="text-(--ink-3)">{synced > 0 ? standingText(rank) : "No songs synced yet."}</span>
    </p>
  )
}

function LevelLine({ gamification }: { gamification: UserGamification }) {
  const progress = levelProgress(gamification.xp, gamification.xpForNext, gamification.xpFloor)
  return (
    <p className="text-[13px] text-(--ink-3) tabular-nums">
      Level{" "}
      <b className="font-bold text-unison-text">
        <OdometerNumber value={gamification.level} />
      </b>
      {" · "}
      {progress.atMax ? (
        "Max level"
      ) : (
        <>
          <OdometerNumber value={progress.remaining} /> XP to Level {gamification.level + 1}
        </>
      )}
    </p>
  )
}

export function ProfileSide({ keyId, rank, gamification, owner, onEditProfile, onConnectDiscord }: ProfileSideProps) {
  const [copied, copy] = useCopied()
  const share = (
    <motion.button
      layout
      type="button"
      onClick={() => copy(profileUrl(rank.handle, keyId))}
      transition={{ layout: LAYOUT_TRANSITION }}
      style={{ borderRadius: 10 }}
      className={owner ? chipClass : raisedChipClass}
    >
      <motion.span layout className="inline-flex">
        <IconSwap
          swapped={copied}
          from={<IconShare className="size-full" stroke={1.75} />}
          to={<IconCheck className="size-full" stroke={1.75} />}
          className={chipIconClass}
        />
      </motion.span>
      <SwapLabel text={copied ? "Copied" : "Share"} />
    </motion.button>
  )

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Lede rank={rank} />
      {gamification && !rank.community ? <LevelLine gamification={gamification} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {rank.discord ? (
          <>
            <DiscordChip id={rank.discord.id} username={rank.discord.username} />
            <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-white/16" />
          </>
        ) : null}
        {owner ? (
          <>
            <a href={`/card/user/${keyId}.png`} download className={raisedChipClass}>
              <IconDownload className={chipIconClass} stroke={1.75} />
              Download card
            </a>
            <button type="button" onClick={onEditProfile} className={chipClass}>
              <IconPencil className={chipIconClass} stroke={1.75} />
              Edit profile
            </button>
            {onConnectDiscord ? (
              <button type="button" onClick={onConnectDiscord} className={chipClass}>
                <DiscordIcon className={chipIconClass} />
                Connect Discord
              </button>
            ) : null}
          </>
        ) : null}
        {share}
      </div>
    </div>
  )
}
