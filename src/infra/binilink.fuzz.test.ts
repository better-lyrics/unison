import { config } from "@/config"
import { lookupIsrcVideo, resolveProviderIds } from "@/infra/binilink"
import { PROVIDER_SERVICES, type ProviderId, readProviderIds } from "@/utils/provider-id"
import { isVideoId } from "@/utils/video-id"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const SEED = Number(process.env.FUZZ_SEED ?? Date.now() % 2 ** 32)
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/
const FORMAT = {
	spotify: /^[A-Za-z0-9]{22}$/,
	apple_music: /^\d{1,128}$/,
	tidal: /^\d{1,128}$/,
}

function mulberry32(seed: number) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
	}
}

const rand = mulberry32(SEED)
const int = (max: number) => Math.floor(rand() * max)
const pick = <T>(items: readonly T[]): T => items[int(items.length)]
const chars = (alphabet: string, length: number) =>
	Array.from({ length }, () => alphabet[int(alphabet.length)]).join("")

const DIGITS = "0123456789"
const BASE62 = `${DIGITS}ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`
const VIDEO = `${BASE62}_-`
const WHITESPACE = [" ", "\t", "\n", " ", " ", "　", "﻿"]
const UNICODE = ["é", "ß", "٣", "１", "𝟗", "Ａ", "🎵", "\u0000", "​", "ﬁ", "Ⅻ"]

function fuzzString(): string {
	switch (int(14)) {
		case 0:
			return ""
		case 1:
			return chars(BASE62, 22)
		case 2:
			return chars(BASE62, int(30))
		case 3:
			return chars(DIGITS, 1 + int(140))
		case 4:
			return `${pick(WHITESPACE)}${chars(BASE62, 22)}${pick(WHITESPACE)}`
		case 5:
			return `${pick(WHITESPACE)}${chars(DIGITS, 1 + int(12))}${pick(WHITESPACE)}`
		case 6:
			return `spotify:track:${chars(BASE62, 22)}`
		case 7:
			return `https://open.spotify.com/track/${chars(BASE62, 22)}?si=${chars(BASE62, 8)}`
		case 8:
			return `https://music.apple.com/us/album/x/1?i=${chars(DIGITS, 10)}`
		case 9:
			return chars(BASE62 + UNICODE.join(""), 1 + int(40))
		case 10:
			return chars(DIGITS, 5000 + int(5000))
		case 11:
			return Array.from({ length: 1 + int(6) }, () => pick(WHITESPACE)).join("")
		case 12:
			return chars(DIGITS, 11) + pick(UNICODE) + chars(DIGITS, 3)
		default:
			return chars(DIGITS + UNICODE.join(""), 1 + int(20))
	}
}

function fuzzIsrc(): unknown {
	const valid = `${chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 2)}${chars(BASE62.slice(0, 36), 3)}${chars(DIGITS, 7)}`
	switch (int(9)) {
		case 0:
			return valid
		case 1:
			return valid.toLowerCase()
		case 2:
			return `${valid.slice(0, 2)}-${valid.slice(2, 5)}-${valid.slice(5, 7)}-${valid.slice(7)}`
		case 3:
			return ` ${valid}\n`
		case 4:
			return valid.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
		case 5:
			return fuzzString()
		case 6:
			return int(1e12)
		case 7:
			return null
		default:
			return [valid]
	}
}

function fuzzVideo(): unknown {
	switch (int(6)) {
		case 0:
			return chars(VIDEO, 11)
		case 1:
			return chars(VIDEO, int(20))
		case 2:
			return `https://youtu.be/${chars(VIDEO, 11)}`
		case 3:
			return null
		case 4:
			return int(100)
		default:
			return fuzzString()
	}
}

function fuzzService(): unknown {
	return pick([...PROVIDER_SERVICES, "Spotify", "apple-music", "youtube", "deezer", "", null, 3])
}

function fuzzValue(depth = 0): unknown {
	switch (int(depth > 2 ? 5 : 8)) {
		case 0:
			return null
		case 1:
			return int(1000) - 500
		case 2:
			return rand() < 0.5
		case 3:
			return fuzzString()
		case 4:
			return undefined
		case 5:
			return Array.from({ length: int(4) }, () => fuzzValue(depth + 1))
		default:
			return { [fuzzString()]: fuzzValue(depth + 1), service: fuzzService() }
	}
}

function fuzzEntry(): unknown {
	if (rand() < 0.15) return fuzzValue()
	const entry: Record<string, unknown> = {}
	if (rand() < 0.9) entry.service = fuzzService()
	if (rand() < 0.9) entry.id = rand() < 0.8 ? fuzzString() : fuzzValue()
	if (rand() < 0.8) entry.isrc = fuzzIsrc()
	if (rand() < 0.7) entry.youtube = fuzzVideo()
	for (const service of PROVIDER_SERVICES) if (rand() < 0.3) entry[service] = fuzzString()
	return entry
}

function fuzzList(): unknown {
	const roll = int(10)
	if (roll === 0) return fuzzValue()
	if (roll === 1 && rand() < 0.1) {
		const entry = {
			service: "spotify",
			id: chars(BASE62, 22),
			isrc: fuzzIsrc(),
			youtube: fuzzVideo(),
		}
		return Array.from({ length: 2000 + int(3000) }, () => entry)
	}
	return Array.from({ length: int(8) }, fuzzEntry)
}

function fuzzResolveBody(): unknown {
	const roll = int(12)
	if (roll === 0) return fuzzValue()
	if (roll === 1) return [fuzzList()]
	const body: Record<string, unknown> = {}
	for (const key of ["results", "not_found", "no_isrc", "pending"]) {
		if (rand() < 0.85) body[key] = fuzzList()
	}
	if (rand() < 0.3 && Array.isArray(body.results) && Array.isArray(body.pending)) {
		body.pending.push(...body.results)
	}
	if (rand() < 0.1) body[fuzzString()] = fuzzValue()
	return body
}

function fuzzLookupBody(isrc: string): unknown {
	const roll = int(10)
	if (roll === 0) return fuzzValue()
	const body: Record<string, unknown> = {}
	if (rand() < 0.85) {
		const list = fuzzList()
		if (Array.isArray(list) && rand() < 0.4) list.push({ isrc, youtube: fuzzVideo() })
		body.results = list
	}
	if (rand() < 0.5) body.pending = rand() < 0.5 ? [isrc, fuzzIsrc()] : fuzzValue()
	if (rand() < 0.3) body.not_found = [isrc]
	return body
}

function respond(body: unknown) {
	const text = body === undefined || rand() < 0.03 ? chars(`${BASE62}{}[]":,`, int(40)) : null
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(new Response(text ?? JSON.stringify(body), { status: 200 }))
	)
}

const sameId = (a: ProviderId, b: ProviderId) => a.service === b.service && a.id === b.id

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

const clearPause = () => vi.advanceTimersByTime(config.binilink.maxPauseSec * 1000 + 1000)

function check(ok: boolean, input: unknown) {
	if (!ok) expect.fail(`FUZZ_SEED=${SEED} input: ${JSON.stringify(input)?.slice(0, 500)}`)
}

const isTrack = (id: ProviderId) =>
	PROVIDER_SERVICES.includes(id.service) && typeof id.id === "string"

describe(`binilink fuzz (FUZZ_SEED=${SEED})`, () => {
	it("readProviderIds returns only well-formed ids in priority order", () => {
		for (let i = 0; i < 5000; i++) {
			const query: Partial<Record<(typeof PROVIDER_SERVICES)[number], string>> = {}
			for (const service of PROVIDER_SERVICES) if (rand() < 0.6) query[service] = fuzzString()

			const { ids } = readProviderIds(query)
			const order = ids.map((id) => PROVIDER_SERVICES.indexOf(id.service))
			check(
				order.every((n, j) => j === 0 || n > order[j - 1]) &&
					ids.every(
						(id) =>
							FORMAT[id.service].test(id.id) &&
							id.id.length <= 128 &&
							id.id === query[id.service]?.trim()
					),
				query
			)
		}
	})

	it("resolveProviderIds survives any response body", async () => {
		const ids: ProviderId[] = [{ service: "spotify", id: "4uLU6hMCjMI75M1A2tKUQC" }]
		for (let i = 0; i < 2000; i++) {
			const body = fuzzResolveBody()
			respond(body)
			const batch = await resolveProviderIds(ids)
			clearPause()
			if (batch === null) continue
			check(
				batch.results.every(
					(r) => isTrack(r) && ISRC.test(r.isrc) && (r.youtube === null || isVideoId(r.youtube))
				) &&
					[...batch.missing, ...batch.pending].every(isTrack) &&
					!batch.pending.some((p) => batch.results.some((r) => sameId(r, p))),
				body
			)
		}
	})

	it("lookupIsrcVideo survives any response body", async () => {
		for (let i = 0; i < 3000; i++) {
			const isrc = String(fuzzIsrc())
			const body = fuzzLookupBody(isrc)
			respond(body)
			const result = await lookupIsrcVideo(isrc)
			clearPause()
			if (result === null) continue
			check(
				["found", "missing", "pending"].includes(result.kind) &&
					(result.kind !== "found" || result.videoId === null || isVideoId(result.videoId)),
				body
			)
		}
	})
})
