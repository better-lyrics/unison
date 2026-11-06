import { AuthorBadges } from "@/components/AuthorBadges"
import { XpAvatar } from "@/components/XpAvatar"
import { SONG_LEVEL_HOLE } from "@/lib/level-hole"
import { Tooltip } from "@/components/Tooltip"
import { UserAvatar } from "@/components/UserAvatar"
import { VariantList } from "@/components/VariantList"
import { Bone } from "@/components/skeleton"
import { glassClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { formatCompact, formatFullDate } from "@/lib/format"
import type { VariantFull, VariantSummary } from "@/lib/types"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

const CARD = cn(glassClass, "rounded-[22px] p-[18px]")
const LABEL = "mb-3 text-xs font-medium text-(--ink-3)"

const SCORE_TIP =
  "Ranking score, weighted by each voter's reputation. Higher shows first. Raw net votes in parentheses."
const VOTES_TIP = "How many people have voted on this version."
const REP_TIP = "Submitter reputation (0 to 2). Trusted users' votes and submissions count for more."

function shortKey(keyId: string): string {
  return keyId.length <= 12 ? keyId : `${keyId.slice(0, 8)}…${keyId.slice(-4)}`
}

function Stat({ value, label, tip }: { value: ReactNode; label: string; tip?: string }) {
  const body = (
    <div className="cursor-default">
      <div className="text-[26px] font-black leading-none tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs text-(--ink-3)">{label}</div>
    </div>
  )
  return tip ? <Tooltip label={tip}>{body}</Tooltip> : body
}

function MetaRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-(--ink-3)">
      {label}
      <span className="ml-auto inline-flex min-w-0 items-center gap-2">{children}</span>
    </div>
  )
}

function StatsCard({ variant, versions }: { variant: VariantFull; versions: number }) {
  const seal = variant.marks?.find((mark) => mark.type === "seal")
  const revision = variant.revision
  return (
    <div className={cn(CARD, "t-reveal")}>
      <div className="grid grid-cols-[repeat(3,auto)] justify-between">
        <Stat
          tip={SCORE_TIP}
          label="Score"
          value={
            <>
              {variant.effectiveScore.toFixed(1)}
              <small className="ml-1 text-sm font-bold text-(--ink-3)">{`(${variant.score})`}</small>
            </>
          }
        />
        <Stat tip={VOTES_TIP} label="Votes" value={formatCompact(variant.voteCount)} />
        <Stat label={versions === 1 ? "Version" : "Versions"} value={versions} />
      </div>
      {seal || variant.isrc || revision ? (
        <div className="mt-[18px] flex flex-col gap-2.5 pt-3.5 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
          {seal ? (
            <MetaRow
              label={
                <>
                  <img src={seal.icon} alt="" className="size-[18px]" />
                  Sealed by
                </>
              }
            >
              {seal.by ? (
                <Link
                  to={`/curator/${seal.by.keyId}`}
                  className="inline-flex min-w-0 items-center gap-1.5 font-bold text-unison-text"
                >
                  <UserAvatar
                    avatarUrl={seal.by.avatarUrl}
                    keyId={seal.by.keyId}
                    className="size-[18px] shrink-0 rounded-full object-cover"
                  />
                  <span className="truncate">{seal.by.displayName}</span>
                </Link>
              ) : (
                <span className="font-bold text-unison-text">Council</span>
              )}
            </MetaRow>
          ) : null}
          {variant.isrc ? (
            <MetaRow label="ISRC">
              <span className="truncate font-mono text-xs text-(--ink-2)">{variant.isrc}</span>
            </MetaRow>
          ) : null}
          {revision ? (
            <MetaRow label="Last edited">
              <span className="font-bold tabular-nums text-unison-text">{formatFullDate(revision.updatedAt)}</span>
              <span className="inline-flex h-[22px] items-center rounded-[7px] bg-white/[0.08] px-2 text-xs font-medium text-(--ink-3) [corner-shape:superellipse(1.6)]">
                {revision.revNo === 1 ? "Original" : `Revision ${revision.revNo}`}
              </span>
            </MetaRow>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SyncedByCard({ submitter }: { submitter: NonNullable<VariantFull["submitter"]> }) {
  return (
    <div className={cn(CARD, "t-reveal")}>
      <p className={LABEL}>Synced by</p>
      <Link to={`/curator/${submitter.keyId}`} className="flex items-center gap-3">
        <XpAvatar
          avatarUrl={submitter.avatarUrl}
          keyId={submitter.keyId}
          level={submitter.level}
          progress={submitter.levelProgress ?? null}
          tiered={Boolean(submitter.tier)}
          hole={SONG_LEVEL_HOLE}
          className="size-[52px] shrink-0"
        />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold">{submitter.displayName}</div>
          <div className="mt-[3px] font-mono text-[11px] text-(--ink-3)">{shortKey(submitter.keyId)}</div>
        </div>
        <Tooltip label={REP_TIP}>
          <span className="ml-auto rounded-full bg-unison-medal-gold/14 px-2 py-1 font-mono text-xs font-medium tabular-nums text-unison-medal-gold">
            {submitter.reputation.toFixed(1)}
          </span>
        </Tooltip>
      </Link>
      {submitter.tier || submitter.featured.length > 0 || submitter.topBadge ? (
        <div className="mt-3.5">
          <AuthorBadges
            tier={submitter.tier}
            featured={submitter.featured}
            topBadge={submitter.topBadge}
            badgeCount={submitter.badgeCount}
          />
        </div>
      ) : null}
    </div>
  )
}

interface SongRailProps {
  variant: VariantFull | undefined
  variants: VariantSummary[]
  selectedId: number
  onSelect: (id: number) => void
}

export function SongRail({ variant, variants, selectedId, onSelect }: SongRailProps) {
  return (
    <aside className="flex flex-col gap-4 [text-shadow:none]">
      {variant ? (
        <StatsCard variant={variant} versions={variants.length} />
      ) : (
        <Bone className="h-[150px] rounded-[22px]" />
      )}
      {variant?.submitter ? <SyncedByCard submitter={variant.submitter} /> : null}
      {!variant ? <Bone className="h-[130px] rounded-[22px]" /> : null}
      {variants.length > 1 ? (
        <div className={CARD}>
          <p className={LABEL}>{`${variants.length} versions`}</p>
          <VariantList variants={variants} selectedId={selectedId} onSelect={onSelect} />
        </div>
      ) : null}
    </aside>
  )
}
