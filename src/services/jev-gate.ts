import { config } from "@/config"
import { Logger } from "@/infra/logger"
import type { LyricLine } from "@/utils/extract-text"
import { renderLinesForDiff } from "@/utils/lyric-diff"

const log = new Logger("jev")

export interface JevCheckInput {
	lyricsId: number
	song: string
	artist: string
	diff: string
	lyrics: string
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

const EARLIER_OMITTED = "[... earlier lines omitted ...]\n"
const LATER_OMITTED = "[... later lines omitted ...]\n"

function changedRegion(current: string[], edited: string[]): { first: number; last: number } {
	let first = 0
	while (first < current.length && first < edited.length && current[first] === edited[first]) {
		first++
	}
	let fromEnd = 0
	while (
		fromEnd < current.length - first &&
		fromEnd < edited.length - first &&
		current[current.length - 1 - fromEnd] === edited[edited.length - 1 - fromEnd]
	) {
		fromEnd++
	}
	const clamp = (i: number) => Math.min(Math.max(i, 0), current.length - 1)
	return { first: clamp(first), last: clamp(Math.max(first, current.length - 1 - fromEnd)) }
}

export function jevLyricContext(
	current: LyricLine[],
	edited: LyricLine[],
	maxChars: number = config.revisions.jevLyricContextChars
): string {
	const rows = current.map((line) => renderLinesForDiff([line]))
	const whole = rows.join("")
	if (whole.length <= maxChars) return whole

	const { first, last } = changedRegion(
		rows,
		edited.map((line) => renderLinesForDiff([line]))
	)
	let budget = maxChars - EARLIER_OMITTED.length - LATER_OMITTED.length
	let lo = first
	let hi = first - 1
	const take = (i: number) => {
		if (i < 0 || i >= rows.length || rows[i].length > budget) return false
		budget -= rows[i].length
		return true
	}
	while (hi < last && take(hi + 1)) hi++
	if (hi === last) {
		let grew = true
		while (grew) {
			grew = false
			if (take(hi + 1)) {
				hi++
				grew = true
			}
			if (take(lo - 1)) {
				lo--
				grew = true
			}
		}
	}
	return [
		lo > 0 ? EARLIER_OMITTED : "",
		...rows.slice(lo, hi + 1),
		hi < rows.length - 1 ? LATER_OMITTED : "",
	].join("")
}

const LEGEND =
	"`lyrics` is the current text of `song` by `artist` before this edit, one lyric line per row, and `diff` is a unified diff of the edit against it. Lines starting with - in `diff` were removed and lines starting with + were added. Any row may start with a [mm:ss.cc] timestamp. A row labelled like [translation es L3] is text from the file header, here the Spanish translation of lyric line 3. When a song is long, `lyrics` shows only the part around the edit and marks the omitted parts."

const MASKING =
	'Replacing a masked or censored word (letters hidden by asterisks or dashes, "[bleep]", or partial masking like f*** or sh*t) with the full word, or masking a full word the other way, is a legitimate correction.'

const SIGNALS = {
	offensive_insertion: {
		type: "noul",
		instructions:
			"Judged against the full `lyrics`, do the added lines in `diff` insert hateful, harassing, or sexually explicit text that clearly does not fit the rest of this song, meaning its tone, subject, and vocabulary?",
		criteria: {
			true: "The edit adds a slur or harassment aimed at real people or groups that is not already in `lyrics` in full or masked form, even if the song is explicit, or it adds hateful or sexually explicit text to lyrics whose tone, subject, and vocabulary give no reason for it.",
			false: `The added text fits the song. Explicit or profane language consistent with the existing \`lyrics\` is legitimate, including a misheard word corrected to a profane one that suits the song. ${MASKING}`,
		},
	},
	unrelated_content: {
		type: "noul",
		instructions:
			"Judged against the full `lyrics`, do the added lines in `diff` insert content unrelated to `song` by `artist`, such as spam, links, advertisements, self-promotion, or lyrics from a different song?",
		criteria: {
			true: "The edit adds text that does not belong in these lyrics: spam, a URL, an ad, a shout-out, or another song's lyrics.",
			false: "Everything the edit adds plausibly belongs to the lyrics of this song.",
		},
	},
	deliberate_corruption: {
		type: "noul",
		instructions:
			"Judged against the full `lyrics`, does `diff` deliberately corrupt the lyrics with garbled words, keyboard mashing, nonsense substitutions, or joke rewrites?",
		criteria: {
			true: "The edit makes the lyrics wrong on purpose, replacing real words with nonsense, gibberish, or jokes.",
			false: `The edit looks like a good-faith correction: fixing typos, misheard words, slang or dialect spellings that match \`lyrics\`, punctuation, capitalization, line breaks, or timing. ${MASKING}`,
		},
	},
	section_removal: {
		type: "noul",
		instructions:
			"Judged against the full `lyrics`, does `diff` remove large sung sections, such as whole verses or choruses, without replacing them?",
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
						lyrics: input.lyrics,
						diff: input.diff,
						legend: LEGEND,
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
