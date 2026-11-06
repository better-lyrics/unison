import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { normalizeIsrc } from "@/utils/isrc"
import { type ProviderId, isProviderService } from "@/utils/provider-id"
import { isVideoId } from "@/utils/video-id"

const log = new Logger("binilink")

export type ResolvedTrack = ProviderId & { isrc: string; youtube: string | null }
export type ResolveBatch = {
	results: ResolvedTrack[]
	missing: ProviderId[]
	pending: ProviderId[]
}
export type IsrcVideo =
	| { kind: "found"; videoId: string | null }
	| { kind: "missing" }
	| { kind: "pending" }

type Fields = Record<string, unknown>

const INPUT_ERRORS = new Set([400, 413])

let pausedUntil = 0

export function pauseRemainingSec(): number {
	return Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000))
}

function pause(retryAfter: string | null): void {
	const requested = Number(retryAfter)
	const seconds =
		Number.isFinite(requested) && requested > 0
			? Math.min(requested, config.binilink.maxPauseSec)
			: config.binilink.pauseSec
	pausedUntil = Date.now() + seconds * 1000
}

async function post(path: string, body: unknown): Promise<Fields | null> {
	if (Date.now() < pausedUntil) return null
	try {
		const res = await fetch(`${config.binilink.baseUrl}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "user-agent": config.binilink.userAgent },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(config.binilink.timeoutMs),
		})
		if (res.ok) {
			const parsed: unknown = await res.json()
			return typeof parsed === "object" && parsed !== null ? (parsed as Fields) : null
		}
		if (!INPUT_ERRORS.has(res.status)) pause(res.headers.get("retry-after"))
		log.warn("binilink rejected", { path, status: res.status })
		return null
	} catch (err) {
		pause(null)
		log.warn("binilink failed", { path, error: (err as Error).message })
		return null
	}
}

function entries(value: unknown): Fields[] {
	return Array.isArray(value)
		? value.filter((item): item is Fields => typeof item === "object" && item !== null)
		: []
}

function providerIds(value: unknown): ProviderId[] {
	return entries(value).flatMap(({ service, id }) =>
		isProviderService(service) && typeof id === "string" ? [{ service, id }] : []
	)
}

function youtube(value: unknown): string | null {
	return typeof value === "string" && isVideoId(value) ? value : null
}

const sameId = (a: ProviderId, b: ProviderId) => a.service === b.service && a.id === b.id

/** Null when BiniLink is paused, failing or answered with something unusable. */
export async function resolveProviderIds(ids: ProviderId[]): Promise<ResolveBatch | null> {
	const body = await post("/api/v1/resolve", ids)
	if (!body) return null

	const results = entries(body.results).flatMap((entry): ResolvedTrack[] => {
		const [id] = providerIds([entry])
		const isrc = typeof entry.isrc === "string" ? normalizeIsrc(entry.isrc) : null
		return id && isrc ? [{ ...id, isrc, youtube: youtube(entry.youtube) }] : []
	})
	return {
		results,
		missing: [...providerIds(body.not_found), ...providerIds(body.no_isrc)],
		pending: providerIds(body.pending).filter((p) => !results.some((r) => sameId(r, p))),
	}
}

export async function lookupIsrcVideo(isrc: string): Promise<IsrcVideo | null> {
	const body = await post("/api/v1/lookup", [isrc])
	if (!body) return null

	const sameIsrc = (value: unknown) => typeof value === "string" && normalizeIsrc(value) === isrc
	const hit = entries(body.results).find((entry) => sameIsrc(entry.isrc))
	if (hit) return { kind: "found", videoId: youtube(hit.youtube) }
	return Array.isArray(body.pending) && body.pending.some(sameIsrc)
		? { kind: "pending" }
		: { kind: "missing" }
}
