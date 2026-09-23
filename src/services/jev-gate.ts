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
