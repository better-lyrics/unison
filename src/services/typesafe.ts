import { config } from "@/config"

export type TypesafeAnswers = Record<string, unknown>

export interface TypesafeRequest {
	state: unknown
	questions: Readonly<Record<string, unknown>>
	timeoutMs: number
}

export interface TypesafeClient {
	ask(request: TypesafeRequest): Promise<TypesafeAnswers>
}

export interface TypesafeClientOptions {
	apiKey: string
	fetch?: typeof fetch
}

export function createTypesafeClient(options: TypesafeClientOptions): TypesafeClient {
	const fetchImpl = options.fetch ?? fetch
	return {
		async ask({ state, questions, timeoutMs }) {
			const res = await fetchImpl(config.typesafe.endpoint, {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ state, model: config.typesafe.model, questions }),
				signal: AbortSignal.timeout(timeoutMs),
			})
			if (!res.ok) throw new Error(`TypeSafe returned ${res.status}`)
			const { answers } = (await res.json()) as { answers?: unknown }
			if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
				throw new Error("TypeSafe response has no answers")
			}
			return answers as TypesafeAnswers
		},
	}
}

function readNumber(answers: TypesafeAnswers, id: string, field: string, max: number): number {
	const value = (answers[id] as Record<string, unknown> | undefined)?.[field]
	if (typeof value !== "number" || !(value >= 0 && value <= max)) {
		throw new Error(`TypeSafe answer for ${id} is missing or out of range`)
	}
	return value
}

export function readNoul(answers: TypesafeAnswers, id: string): number {
	return readNumber(answers, id, "noul", 1)
}

export function readScore(answers: TypesafeAnswers, id: string, topLevel: number): number {
	return readNumber(answers, id, "score", topLevel)
}
