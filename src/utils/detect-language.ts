export const DETECTOR_VERSION = 4

export interface DetectResult {
	language: string | null
	ready: boolean
}

type Eld = typeof import("eld/large")["eld"]

let eldPromise: Promise<Eld> | null = null

function getEld(): Promise<Eld> {
	if (!eldPromise) eldPromise = import("eld/large").then((m) => m.eld)
	return eldPromise
}

function classify(eld: Eld, text: string): DetectResult {
	if (!text.trim()) return { language: null, ready: true }
	const result = eld.detect(text)
	if (result.language && result.isReliable()) {
		return { language: result.language, ready: true }
	}
	return { language: null, ready: true }
}

export async function detectLanguage(text: string): Promise<DetectResult> {
	if (!text.trim()) return { language: null, ready: true }
	return classify(await getEld(), text)
}

export async function detectLanguageBatch(texts: string[]): Promise<DetectResult[]> {
	if (texts.length === 0) return []
	const eld = await getEld()
	return texts.map((t) => classify(eld, t))
}
