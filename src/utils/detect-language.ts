import { Logger } from "@/infra/logger"

const log = new Logger("detect-language")

export const DETECTOR_VERSION = 3

const SINGLE_TIMEOUT_MS = 2_000
const BATCH_TIMEOUT_MS = 30_000
const CONFIDENCE_THRESHOLD = 0.5

export interface DetectResult {
	language: string | null
	ready: boolean
}

interface DetectResponse {
	iso6391: string | null
	confidence: number
}

interface BatchResponse {
	results: DetectResponse[]
}

function gate(resp: DetectResponse): DetectResult {
	if (resp.iso6391 && resp.confidence >= CONFIDENCE_THRESHOLD) {
		return { language: resp.iso6391, ready: true }
	}
	return { language: null, ready: true }
}

function unreachable(count: number): DetectResult[] {
	return Array.from({ length: count }, () => ({ language: null, ready: false }))
}

export async function detectLanguage(text: string): Promise<DetectResult> {
	if (!text.trim()) return { language: null, ready: true }

	const url = process.env.DETECTION_URL
	if (!url) return { language: null, ready: false }

	try {
		const res = await fetch(`${url}/detect`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
			signal: AbortSignal.timeout(SINGLE_TIMEOUT_MS),
		})
		if (!res.ok) {
			log.warn("detect non-2xx", { status: res.status })
			return { language: null, ready: false }
		}
		const body = (await res.json()) as DetectResponse
		return gate(body)
	} catch (err) {
		log.warn("detect failed", { error: (err as Error).message })
		return { language: null, ready: false }
	}
}

export async function detectLanguageBatch(texts: string[]): Promise<DetectResult[]> {
	if (texts.length === 0) return []

	const url = process.env.DETECTION_URL
	if (!url) return unreachable(texts.length)

	try {
		const res = await fetch(`${url}/detect/batch`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ texts }),
			signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			log.warn("batch non-2xx", { status: res.status, n: texts.length })
			return unreachable(texts.length)
		}
		const body = (await res.json()) as BatchResponse
		return body.results.map(gate)
	} catch (err) {
		log.warn("batch failed", { error: (err as Error).message, n: texts.length })
		return unreachable(texts.length)
	}
}
