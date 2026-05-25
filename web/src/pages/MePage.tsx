import { IconCheck, IconCopy } from "@tabler/icons-react"
import { useCallback, useState } from "react"
import { useSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchMyCuratorRank } from "@/lib/api"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { formatRank, formatVotes } from "@/lib/format"
import type { MyCuratorRankResponse } from "@/lib/types"

const NOT_RANKED: MyCuratorRankResponse = { ranked: false }

export function MePage() {
	const session = useSession()
	const keyId = session.status === "signed-in" ? session.identity.keyId : null
	const fetcher = useCallback(
		() => (keyId ? fetchMyCuratorRank(keyId) : Promise.resolve(NOT_RANKED)),
		[keyId],
	)
	const rank = useAsyncData(fetcher)
	const [copied, setCopied] = useState(false)

	const copyKey = async () => {
		if (!keyId) return
		await navigator.clipboard.writeText(keyId)
		setCopied(true)
		window.setTimeout(() => setCopied(false), 1500)
	}

	if (session.status === "loading") {
		return (
			<LeaderboardSection title="Me">
				<LoadingPlaceholder />
			</LeaderboardSection>
		)
	}

	if (session.status !== "signed-in") {
		return (
			<EmptyState
				title="Not signed in"
				hint="Sign in with Better Lyrics from the header to see your stats."
			/>
		)
	}

	const { identity } = session

	return (
		<LeaderboardSection title="Me">
			<div className="space-y-6">
				<div className="flex items-center gap-4 rounded-lg border border-unison-border bg-unison-bg-elevated p-4">
					<img
						src={dicebearThumbsDataUri(identity.keyId)}
						alt=""
						className="size-16 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
					/>
					<div className="min-w-0 flex-1 space-y-1">
						<p className="text-lg font-semibold text-unison-text">{identity.displayName}</p>
						<div className="flex items-center gap-2">
							<code className="truncate font-mono text-xs text-unison-text-muted">
								{identity.keyId}
							</code>
							<button
								type="button"
								onClick={copyKey}
								aria-label={copied ? "Copied" : "Copy key id"}
								className="cursor-pointer shrink-0 rounded-md p-1 text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
							>
								{copied ? (
									<IconCheck className="size-4" stroke={1.5} />
								) : (
									<IconCopy className="size-4" stroke={1.5} />
								)}
							</button>
						</div>
					</div>
				</div>

				{rank.status === "loading" ? (
					<LoadingPlaceholder />
				) : rank.status === "error" || !rank.data.ranked ? (
					<EmptyState
						title="No leaderboard activity yet"
						hint="Submit lyrics via Better Lyrics to start showing up on the curator board."
					/>
				) : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat label="Rank" value={formatRank(rank.data.rank)} />
						<Stat label="Score" value={rank.data.score.toFixed(1)} />
						<Stat label="Submissions" value={String(rank.data.submissionCount)} />
						<Stat label="Upvotes" value={formatVotes(rank.data.totalUpvotes)} />
					</div>
				)}
			</div>
		</LeaderboardSection>
	)
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
