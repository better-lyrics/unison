import { IconCheck, IconCopy } from "@tabler/icons-react"
import { useCallback, useState } from "react"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { SubmissionsList } from "@/components/SubmissionsList"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserRank } from "@/lib/api"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { formatExact, formatRank, formatRelativeTime } from "@/lib/format"

interface UserProfileViewProps {
  keyId: string
  title?: string
}

interface StatProps {
  label: string
  value: string
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3">
      <p className="font-mono text-lg text-unison-text">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">{label}</p>
    </div>
  )
}

export function UserProfileView({ keyId, title = "Profile" }: UserProfileViewProps) {
  const rankFetcher = useCallback(() => fetchUserRank(keyId), [keyId])
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)
  const [copied, setCopied] = useState(false)

  const copyKey = async () => {
    await navigator.clipboard.writeText(keyId)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (rank.status === "loading") {
    return (
      <LeaderboardSection title={title}>
        <LoadingPlaceholder />
      </LeaderboardSection>
    )
  }

  if (rank.status === "error") {
    return <EmptyState title="Could not load profile" hint={rank.error.message} />
  }

  const data = rank.data

  return (
    <LeaderboardSection title={title}>
      <div className="space-y-6">
        <div className="flex items-center gap-4 rounded-lg border border-unison-border bg-unison-bg-elevated p-4">
          <img
            src={dicebearThumbsDataUri(data.keyId)}
            alt=""
            className="size-16 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-lg font-semibold text-unison-text">{data.displayName}</p>
            <div className="flex items-center gap-2">
              <code title={data.keyId} className="font-mono text-xs text-unison-text-muted">
                {`${data.keyId.slice(0, 6)}…${data.keyId.slice(-6)}`}
              </code>
              <button
                type="button"
                onClick={copyKey}
                aria-label={copied ? "Copied" : "Copy key id"}
                className="cursor-pointer shrink-0 rounded-md p-1 text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
              >
                {copied ? <IconCheck className="size-4" stroke={1.5} /> : <IconCopy className="size-4" stroke={1.5} />}
              </button>
            </div>
            <p className="text-xs text-unison-text-muted">
              {data.lastVoteAt !== null ? `Last voted ${formatRelativeTime(data.lastVoteAt)}` : "Hasn't voted yet"}
            </p>
          </div>
        </div>

        {data.ranked ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rank" value={formatRank(data.rank)} />
            <Stat label="Score" value={formatExact(data.score)} />
            <Stat label="Submissions" value={formatExact(data.submissionCount)} />
            <Stat label="Upvotes" value={formatExact(data.totalUpvotes)} />
          </div>
        ) : (
          <EmptyState
            title="No leaderboard activity yet"
            hint="Submit lyrics via Better Lyrics to start showing up on the leaderboard."
          />
        )}

        <SubmissionsList keyId={keyId} />
      </div>
    </LeaderboardSection>
  )
}
