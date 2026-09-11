#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
	driftTtml,
	lowercaseTtmlText,
	pickSectionWindow,
	shiftTtml,
	trimTtmlToWindow,
} from "@/utils/ttml-timing"

// Builds the private exam bank from a local spec. The spec (song refs, question copy,
// answer keys) lives only in a gitignored file; this script holds no content. For each
// timing question it fetches the word-timed TTML for the referenced ISRC, aligns it to
// the video (per-song offset), picks a judged window, and synthesises the clean and
// degraded renderings the question needs. Everything else (mcq, scenario) passes through.
// Output goes to the gitignored scripts/local/exam-bank.json, ready for `pnpm exam:seed`.
//
// Usage: pnpm run exam:build [path-to-spec.json] [path-to-output.json]

const STORAGE_BASE = "https://lyrics-storage.binimum.org"
const UNISON_BASE = "https://unison.boidu.dev"

interface Degrade {
	kind: "lag" | "early" | "drift"
	amount: number
}

type ContentTransform = "lowercase"

interface RenderingSpec {
	id: string
	label?: string
	degrade?: Degrade | null
	content?: ContentTransform | null
}

interface WindowSpec {
	start?: number
	end?: number
	prefer?: string[]
	maxSec?: number
}

interface BuildSpec {
	song: string
	window?: WindowSpec
	renderings: RenderingSpec[]
}

interface ChoicePart {
	part: string
	label: string
	options: { id: string; label: string }[]
}

interface AnswerKeyPart {
	id: string
	points: Record<string, number>
	overSeal?: string
}

interface SpecQuestion {
	id: number
	type: "timing" | "mcq" | "scenario"
	category: string
	prompt: string
	weight: number
	build?: BuildSpec
	choices?: ChoicePart[]
	steps?: unknown[]
	answerKey: { parts: AnswerKeyPart[] }
}

interface SongRef {
	videoId: string
	offset?: number
	// Where the TTML comes from. Default fetches Apple word-timed TTML from Bini by
	// ISRC (the song key). "unison" fetches the crowdsourced rendering from the public
	// Unison API by videoId, so an exam clip can be the exact sync Unison serves.
	source?: "bini" | "unison"
}

interface Spec {
	songs: Record<string, SongRef>
	questions: SpecQuestion[]
}

const ttmlCache = new Map<string, Promise<string>>()

function fetchTtml(isrc: string): Promise<string> {
	const cached = ttmlCache.get(isrc)
	if (cached) return cached
	const p = (async () => {
		const res = await fetch(`${STORAGE_BASE}/${isrc}.ttml`, {
			signal: AbortSignal.timeout(20000),
		})
		if (!res.ok) throw new Error(`TTML fetch failed for ${isrc}: ${res.status}`)
		return res.text()
	})()
	ttmlCache.set(isrc, p)
	return p
}

function fetchUnisonTtml(videoId: string): Promise<string> {
	const key = `unison:${videoId}`
	const cached = ttmlCache.get(key)
	if (cached) return cached
	const p = (async () => {
		const res = await fetch(`${UNISON_BASE}/lyrics?v=${encodeURIComponent(videoId)}`, {
			signal: AbortSignal.timeout(20000),
		})
		if (!res.ok) throw new Error(`Unison fetch failed for ${videoId}: ${res.status}`)
		const body = (await res.json()) as { data?: { lyrics?: string; format?: string } }
		const lyrics = body.data?.lyrics
		if (!lyrics) throw new Error(`Unison returned no lyrics for ${videoId}`)
		if (body.data?.format !== "ttml") {
			throw new Error(`Unison lyrics for ${videoId} are ${body.data?.format}, not ttml`)
		}
		return lyrics
	})()
	ttmlCache.set(key, p)
	return p
}

function degrade(
	ttml: string,
	start: number,
	end: number,
	spec: Degrade | null | undefined
): string {
	if (!spec) return ttml
	if (spec.kind === "lag") return shiftTtml(ttml, spec.amount)
	if (spec.kind === "early") return shiftTtml(ttml, -spec.amount)
	return driftTtml(ttml, start, end, spec.amount)
}

function applyContent(ttml: string, transform: ContentTransform | null | undefined): string {
	if (transform === "lowercase") return lowercaseTtmlText(ttml)
	return ttml
}

async function buildClip(spec: Spec, build: BuildSpec) {
	const song = spec.songs[build.song]
	if (!song) throw new Error(`unknown song ref ${build.song}`)
	const raw = song.source === "unison" ? await fetchUnisonTtml(song.videoId) : await fetchTtml(build.song)
	const aligned = shiftTtml(raw, song.offset ?? 0)

	let start = build.window?.start
	let end = build.window?.end
	if (start === undefined || end === undefined) {
		const picked = pickSectionWindow(aligned, {
			prefer: build.window?.prefer,
			maxSec: build.window?.maxSec,
		})
		if (!picked) throw new Error(`no section window found for ${build.song}`)
		start = start ?? picked.start
		end = end ?? picked.end
	}

	const round3 = (n: number) => Math.round(n * 1000) / 1000
	const s = round3(start)
	const e = round3(end)
	// Trim to the judged section on the clean timeline first, so only those lines show
	// and every rendering carries the same set (degradation only reshapes their timing).
	const windowed = trimTtmlToWindow(aligned, s, e)
	const renderings = build.renderings.map((r) => ({
		id: r.id,
		...(r.label ? { label: r.label } : {}),
		ttml: applyContent(degrade(windowed, s, e, r.degrade), r.content),
	}))

	return { source: { videoId: song.videoId, start: s, end: e }, renderings }
}

function validate(q: SpecQuestion): void {
	if (q.type === "scenario") {
		const surfaces = (q.steps ?? []) as { id: string; composer?: { choices: { id: string }[] } }[]
		const scored = new Map(surfaces.filter((s) => s.composer).map((s) => [s.id, s.composer]))
		for (const part of q.answerKey.parts) {
			const composer = scored.get(part.id)
			if (!composer) throw new Error(`q${q.id}: answer part "${part.id}" has no composer surface`)
			const ids = new Set(composer.choices.map((c) => c.id))
			for (const choiceId of Object.keys(part.points)) {
				if (!ids.has(choiceId)) throw new Error(`q${q.id}.${part.id}: unknown choice "${choiceId}"`)
			}
		}
		return
	}
	const parts = new Map((q.choices ?? []).map((c) => [c.part, new Set(c.options.map((o) => o.id))]))
	for (const part of q.answerKey.parts) {
		const options = parts.get(part.id)
		if (!options) throw new Error(`q${q.id}: answer part "${part.id}" has no matching choice part`)
		for (const choiceId of Object.keys(part.points)) {
			if (!options.has(choiceId))
				throw new Error(`q${q.id}.${part.id}: unknown choice "${choiceId}"`)
		}
		if (part.overSeal && !options.has(part.overSeal))
			throw new Error(`q${q.id}.${part.id}: overSeal "${part.overSeal}" is not an option`)
	}
}

async function main() {
	const specPath = resolve(process.argv[2] ?? "scripts/local/exam-songs.json")
	const outPath = resolve(process.argv[3] ?? "scripts/local/exam-bank.json")
	const spec = JSON.parse(readFileSync(specPath, "utf-8")) as Spec

	const questions = []
	for (const q of spec.questions) {
		validate(q)
		if (!q.build) {
			const { build, ...rest } = q
			void build
			questions.push(rest)
			continue
		}
		const clip = await buildClip(spec, q.build)
		const { build, ...rest } = q
		void build
		questions.push({ ...rest, assets: { clip } })
	}

	const bank = {
		_note:
			"GENERATED by scripts/build-exam-bank.ts from a local spec. Do not edit by hand; edit the spec and rebuild. scripts/local is gitignored.",
		questions,
	}
	writeFileSync(outPath, `${JSON.stringify(bank, null, "\t")}\n`)
	console.log(`built ${questions.length} questions -> ${outPath}`)
}

main().catch((err) => {
	console.error(`build failed: ${(err as Error).message}`)
	process.exit(1)
})
