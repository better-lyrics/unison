import { config } from "@/config"
import { type BookmarkView, listActiveBookmarks, toBookmarkView } from "@/db/council-bookmarks"
import { type CouncilPerson, loadPersonDecor, toCouncilPerson } from "@/db/council-person"
import { resolvePeopleByKeyIds } from "@/db/users"
import { type PendingRevisionSummary, listPendingRevisions } from "@/services/lyric-revisions"
import type { Env } from "@/types"

export interface EditItem extends Omit<PendingRevisionSummary, "author" | "authorKeyId"> {
	author: CouncilPerson | null
	bookmark: BookmarkView | null
}

export interface EditThresholds {
	textDrift: number
	timingDrift: number
	jevFlag: number
}

export async function listCouncilEdits(
	env: Env
): Promise<{ items: EditItem[]; thresholds: EditThresholds }> {
	const cards = await listPendingRevisions(env)
	const [people, bookmarks] = await Promise.all([
		resolvePeopleByKeyIds(
			env,
			cards.flatMap((c) => (c.authorKeyId ? [c.authorKeyId] : []))
		),
		listActiveBookmarks(env, { itemType: "edit", itemIds: cards.map((c) => c.revisionId) }),
	])
	const decor = await loadPersonDecor(env, [...people.values(), ...bookmarks.map((b) => b.holder)])
	const bookmarkByItem = new Map(bookmarks.map((b) => [b.itemId, b]))
	const items = cards.map(({ author: _author, authorKeyId, ...card }) => {
		const person = authorKeyId ? people.get(authorKeyId) : undefined
		const bookmark = bookmarkByItem.get(card.revisionId)
		return {
			...card,
			author: person ? toCouncilPerson(person, decor) : null,
			bookmark: bookmark ? toBookmarkView(bookmark, decor) : null,
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
