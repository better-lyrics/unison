import { config } from "@/config"
import { encode } from "uqr"

const FINDER = 7
const LOGO_HOLE = 5
const CORNER_RADIUS = 2.5

export interface QrModules {
	size: number
	dots: [number, number][]
	hole: { start: number; size: number }
}

export const profileQrUrl = (handle: string) => `${config.og.siteOrigin}/u/${handle}`.toUpperCase()

export function qrModules(text: string): QrModules {
	const { data, size } = encode(text, { ecc: "L", border: 0 })
	const start = Math.floor((size - LOGO_HOLE) / 2)
	const inHole = (x: number, y: number) =>
		x >= start && x < start + LOGO_HOLE && y >= start && y < start + LOGO_HOLE
	const inFinder = (x: number, y: number) =>
		(x < FINDER && y < FINDER) || (x >= size - FINDER && y < FINDER) || (x < FINDER && y >= size - FINDER)
	const corner = size - CORNER_RADIUS
	const pastCorner = (x: number, y: number) =>
		x + 0.5 > corner &&
		y + 0.5 > corner &&
		Math.hypot(x + 0.5 - corner, y + 0.5 - corner) > CORNER_RADIUS - 0.45
	const dots: [number, number][] = []
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (data[y]?.[x] && !inHole(x, y) && !inFinder(x, y) && !pastCorner(x, y)) dots.push([x, y])
		}
	}
	return { size, dots, hole: { start, size: LOGO_HOLE } }
}
