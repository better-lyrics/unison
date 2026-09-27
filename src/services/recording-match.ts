import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { readScore } from "@/services/typesafe"
import type { Env } from "@/types"
import { sha256Hex } from "@/utils/hash"
import type { SongCandidate } from "@/utils/innertube"

const log = new Logger("recording-match")

export type MatchLevel = "same" | "related" | "different"
export type RecordingMatch = { level: MatchLevel; score: number }
export type LyricTrack = { title: string; artist: string; lyricsId?: number }
export type Matched<T> = T & { match: RecordingMatch | null }

const TOP_LEVEL = 2
const QUESTIONS = {
	link: {
		type: "score",
		instructions: "How do `lyric_track` and `candidate` relate as recordings?",
		criteria: [
			"Different recordings: another song, or an alternate version such as a remix, live, acoustic, instrumental, sped up, re-recorded or other-language version.",
			"Closely related, may or may not be the same recording: an edit, a variant, or a title that could name either.",
			"The same recording, only a different upload or release of it, such as another album, deluxe edition, single or compilation, or a title that only adds credits for the same performers.",
		],
	},
} as const

const LEVEL_ORDER: Record<MatchLevel | "unjudged", number> = {
	same: 0,
	related: 1,
	unjudged: 2,
	different: 3,
}

export function matchLevel(score: number): MatchLevel {
	if (score < 0.5) return "different"
	if (score < 1.5) return "related"
	return "same"
}

export function recordingMatchState(lyric: LyricTrack, candidate: SongCandidate) {
	return {
		lyric_track: { title: lyric.title, artist: lyric.artist },
		candidate: {
			title: candidate.title,
			artists: candidate.artists,
			album: candidate.album,
			kind: candidate.videoType === "song" ? "audio track" : "video upload",
		},
	}
}

function cacheKey(lyric: LyricTrack, candidate: SongCandidate): string {
	const state = JSON.stringify(recordingMatchState(lyric, candidate))
	return `recmatch:${config.videoLinking.recordingMatch.cacheVersion}:${sha256Hex(state)}`
}

export async function cachedRecordingMatch(
	env: Env,
	lyric: LyricTrack,
	candidate: SongCandidate
): Promise<RecordingMatch | null> {
	const cached = await env.CACHE.get(cacheKey(lyric, candidate))
	if (!cached) return null
	try {
		const score = readScore({ link: JSON.parse(cached) }, "link", TOP_LEVEL)
		return { level: matchLevel(score), score }
	} catch {
		return null
	}
}

async function judge(
	env: Env,
	lyric: LyricTrack,
	candidate: SongCandidate
): Promise<RecordingMatch | null> {
	const client = env.TYPESAFE
	if (!client) return null
	try {
		const cached = await cachedRecordingMatch(env, lyric, candidate)
		if (cached) return cached
		const answers = await client.ask({
			state: recordingMatchState(lyric, candidate),
			questions: QUESTIONS,
			timeoutMs: config.videoLinking.recordingMatch.timeoutMs,
		})
		const score = readScore(answers, "link", TOP_LEVEL)
		await env.CACHE.put(cacheKey(lyric, candidate), JSON.stringify({ score }), {
			expirationTtl: config.videoLinking.recordingMatch.cacheTtlSeconds,
		})
		return { level: matchLevel(score), score }
	} catch (err) {
		log.warn("recording match failed, leaving the suggestion unjudged", {
			lyricsId: lyric.lyricsId,
			videoId: candidate.videoId,
			error: (err as Error).message,
		})
		return null
	}
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0
	const worker = async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await fn(items[index])
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

export async function matchSuggestions<T extends SongCandidate>(
	env: Env,
	lyric: LyricTrack,
	suggestions: T[]
): Promise<Matched<T>[]> {
	const { maxCandidates, concurrency } = config.videoLinking.recordingMatch
	const judged = await mapWithConcurrency(suggestions.slice(0, maxCandidates), concurrency, (s) =>
		judge(env, lyric, s)
	)
	const rank = (s: Matched<T>) => LEVEL_ORDER[s.match?.level ?? "unjudged"]
	return suggestions
		.map((s, i) => ({ ...s, match: judged[i] ?? null }))
		.sort((a, b) => rank(a) - rank(b))
}
