import { config } from "@/config"
import { listActiveBookmarks } from "@/db/council-bookmarks"
import {
	type CouncilPerson,
	type QueueBookmark,
	toQueueBookmark,
	withTier,
} from "@/db/council-queue"
import { getCuratorTierMap } from "@/db/leaderboard"
import { resolvePeopleByKeyIds } from "@/db/users"
import { listPendingCards } from "@/services/lyric-revisions"
import type { Env, PendingRevisionCard } from "@/types"

export interface EditItem extends Omit<PendingRevisionCard, "author" | "authorKeyId"> {
	author: CouncilPerson | null
	bookmark: QueueBookmark | null
}

export interface EditThresholds {
	textDrift: number
	timingDrift: number
	jevFlag: number
}

export async function listCouncilEdits(
	env: Env
): Promise<{ items: EditItem[]; thresholds: EditThresholds }> {
	const cards = await listPendingCards(env)
	const [people, tiers, bookmarks] = await Promise.all([
		resolvePeopleByKeyIds(
			env,
			cards.flatMap((c) => (c.authorKeyId ? [c.authorKeyId] : []))
		),
		getCuratorTierMap(env),
		listActiveBookmarks(env, { itemType: "edit", itemIds: cards.map((c) => c.revisionId) }),
	])
	const bookmarkByItem = new Map(bookmarks.map((b) => [b.itemId, b]))
	const items = cards.map(({ author: _author, authorKeyId, ...card }) => {
		const person = authorKeyId ? people.get(authorKeyId) : undefined
		const bookmark = bookmarkByItem.get(card.revisionId)
		return {
			...card,
			author: person ? withTier(person, tiers) : null,
			bookmark: bookmark ? toQueueBookmark(bookmark, tiers) : null,
		}
	})
	return {
		items,
		thresholds: {
			textDrift: config.revisions.textDriftLimit,
			timingDrift: config.revisions.timingDriftLimit,
			jevFlag: config.revisions.jevFlagThreshold,
		},
	}
}
