import { Logger } from "@/infra/logger"

const log = new Logger("ntfy")

const TIMEOUT_MS = 5_000

export async function notify(message: string, opts?: { title?: string }): Promise<boolean> {
	const url = process.env.NTFY_TOPIC_URL
	if (!url) return false

	const headers: Record<string, string> = { Priority: "default", Tags: "warning" }
	if (opts?.title) headers.Title = opts.title

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: message,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) {
			log.warn("ntfy non-2xx", { status: res.status })
			return false
		}
		return true
	} catch (err) {
		log.warn("ntfy failed", { error: (err as Error).message })
		return false
	}
}
