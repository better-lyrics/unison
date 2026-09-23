import { config } from "@/config"
import { Logger } from "@/infra/logger"

const log = new Logger("jev")

export interface JevCheckInput {
	lyricsId: number
	song: string
	artist: string
	diff: string
}

export interface JevVerdict {
	flagged: boolean
	probability: number | null
}

export interface JevGate {
	check(input: JevCheckInput): Promise<JevVerdict>
}

const NOT_FLAGGED: JevVerdict = { flagged: false, probability: null }

export const disabledJevGate: JevGate = {
	check: async () => NOT_FLAGGED,
}

export async function runJevStep(gate: JevGate, input: JevCheckInput): Promise<JevVerdict> {
	try {
		return await gate.check(input)
	} catch (err) {
		log.warn("jev check failed, treating the edit as not flagged", {
			lyricsId: input.lyricsId,
			error: (err as Error).message,
		})
		return NOT_FLAGGED
	}
}

const DIFF_LEGEND =
	"`diff` is a unified diff of a lyric edit. Lines starting with - were removed, lines starting with + were added, and each line may start with a [mm:ss.cc] timestamp."

const SIGNALS = {
	offensive_insertion: {
		type: "noul",
		instructions:
			"Do the added lines in `diff` insert offensive, hateful, harassing, or sexually explicit text that is not part of the lyrics of `song` by `artist`?",
		criteria: {
			true: "The edit adds slurs, hate, harassment, or explicit content that the song itself does not contain.",
			false:
				"The edit adds no such text, or the words were already present in the removed lines because the song contains them.",
		},
	},
	unrelated_content: {
		type: "noul",
		instructions:
			"Do the added lines in `diff` insert content unrelated to `song` by `artist`, such as spam, links, advertisements, self-promotion, or lyrics from a different song?",
		criteria: {
			true: "The edit adds text that does not belong in these lyrics: spam, a URL, an ad, a shout-out, or another song's lyrics.",
			false: "Everything the edit adds plausibly belongs to the lyrics of this song.",
		},
	},
	deliberate_corruption: {
		type: "noul",
		instructions:
			"Does `diff` deliberately corrupt the lyrics with garbled words, keyboard mashing, nonsense substitutions, or joke rewrites?",
		criteria: {
			true: "The edit makes the lyrics wrong on purpose, replacing real words with nonsense, gibberish, or jokes.",
			false:
				"The edit looks like a good-faith correction: fixing typos, misheard words, punctuation, capitalization, line breaks, or timing.",
		},
	},
	section_removal: {
		type: "noul",
		instructions:
			"Does `diff` remove large sung sections of the lyrics, such as whole verses or choruses, without replacing them?",
		criteria: {
			true: "Several consecutive sung lines are deleted and nothing equivalent is added in their place.",
			false:
				"No large sung section is removed, or removed lines are replaced by corrected versions of the same section.",
		},
	},
} as const

type SignalId = keyof typeof SIGNALS

export interface TypesafeJevOptions {
	apiKey: string
	fetch?: typeof fetch
}

function readProbability(answers: unknown, id: SignalId): number {
	const answer = (answers as Record<string, { noul?: unknown }> | undefined)?.[id]
	const noul = answer?.noul
	if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
		throw new Error(`TypeSafe answer for ${id} is missing or out of range`)
	}
	return noul
}

export function createTypesafeJevGate(options: TypesafeJevOptions): JevGate {
	const fetchImpl = options.fetch ?? fetch
	return {
		async check(input) {
			const res = await fetchImpl(config.revisions.jevEndpoint, {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					state: {
						song: input.song,
						artist: input.artist,
						diff: input.diff,
						diff_legend: DIFF_LEGEND,
					},
					model: config.revisions.jevModel,
					questions: SIGNALS,
				}),
				signal: AbortSignal.timeout(config.revisions.jevTimeoutMs),
			})
			if (!res.ok) throw new Error(`TypeSafe returned ${res.status}`)
			const { answers } = (await res.json()) as { answers?: unknown }
			const probability = Math.max(
				...(Object.keys(SIGNALS) as SignalId[]).map((id) => readProbability(answers, id))
			)
			return { flagged: probability >= config.revisions.jevFlagThreshold, probability }
		},
	}
}
