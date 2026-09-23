import { readFileSync } from "node:fs"

export function readRevisionFixture(name: string): string {
	return readFileSync(new URL(`../utils/__fixtures__/revisions/${name}`, import.meta.url), "utf-8")
}

// Each word appears once in amazing-grace.lrc, and each swap moves text drift by 1/98.
export const AMAZING_GRACE_SWAPS: Array<[string, string]> = [
	["sweet", "soft"],
	["wretch", "soul"],
	["lost", "gone"],
	["blind", "dark"],
	["taught", "told"],
	["fear", "fright"],
	["relieved", "released"],
	["precious", "dear"],
	["hour", "day"],
	["dangers", "perils"],
	["toils", "trials"],
	["snares", "traps"],
	["brought", "led"],
	["promised", "pledged"],
	["secures", "assures"],
	["shield", "strength"],
	["portion", "refuge"],
	["endures", "remains"],
]

export function swapWords(lyrics: string, count: number): string {
	return AMAZING_GRACE_SWAPS.slice(0, count).reduce(
		(text, [from, to]) => text.replace(from, to),
		lyrics
	)
}

export function shiftLrc(lrc: string, deltaForLine: (index: number) => number): string {
	const pad = (n: number) => String(n).padStart(2, "0")
	let index = 0
	return lrc.replace(
		/^\[(\d{2}):(\d{2})\.(\d{2})\]/gm,
		(_m, mm: string, ss: string, cc: string) => {
			const ms = (Number(mm) * 60 + Number(ss)) * 1000 + Number(cc) * 10 + deltaForLine(index++)
			return `[${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(Math.floor((ms % 1000) / 10))}]`
		}
	)
}
