export type FeedSort = "default" | "newest" | "top-rated" | "most-voted"
export type FeedSortDir = "desc" | "asc"
export type FeedSyncType = "richsync" | "linesync" | "plain"
export type FeedFormat = "lrc" | "ttml" | "plain"
export type FeedTier = "trusted-plus" | "top-rated"

export interface FeedFilters {
	sort?: FeedSort
	sortDir?: FeedSortDir
	syncType?: FeedSyncType
	format?: FeedFormat
	tier?: FeedTier
	language?: string
}

const SORT_VALUES = new Set<FeedSort>(["default", "newest", "top-rated", "most-voted"])
const SORT_DIR_VALUES = new Set<FeedSortDir>(["desc", "asc"])
const SYNC_TYPE_VALUES = new Set<FeedSyncType>(["richsync", "linesync", "plain"])
const FORMAT_VALUES = new Set<FeedFormat>(["lrc", "ttml", "plain"])
const TIER_VALUES = new Set<FeedTier>(["trusted-plus", "top-rated"])

interface RawQuery {
	sort?: string
	sortDir?: string
	syncType?: string
	format?: string
	tier?: string
	language?: string
}

export function parseFeedFilters(query: RawQuery): FeedFilters {
	const out: FeedFilters = {}

	if (query.sort && SORT_VALUES.has(query.sort as FeedSort)) {
		out.sort = query.sort as FeedSort
	}
	if (query.sortDir) {
		out.sortDir = SORT_DIR_VALUES.has(query.sortDir as FeedSortDir)
			? (query.sortDir as FeedSortDir)
			: "desc"
	}
	if (query.syncType && SYNC_TYPE_VALUES.has(query.syncType as FeedSyncType)) {
		out.syncType = query.syncType as FeedSyncType
	}
	if (query.format && FORMAT_VALUES.has(query.format as FeedFormat)) {
		out.format = query.format as FeedFormat
	}
	if (query.tier && TIER_VALUES.has(query.tier as FeedTier)) {
		out.tier = query.tier as FeedTier
	}
	if (query.language) {
		out.language = query.language
	}

	return out
}

export function hasAnyFilter(filters: FeedFilters): boolean {
	if (filters.syncType || filters.format || filters.tier || filters.language) return true
	if (filters.sort && filters.sort !== "default") return true
	return false
}
