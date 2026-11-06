export interface Accent {
	hue: number
	lum: number
	clear: number
}

export const FALLBACK_HUE = 260

export function accentFromPixels(px: Uint8ClampedArray | Uint8Array): Accent {
	const bins = Array.from({ length: 12 }, () => ({ w: 0, hue: 0 }))
	const count = px.length / 4
	let lum = 0
	let clear = 0
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 128) clear++
		const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
		lum += (r * 0.299 + g * 0.587 + b * 0.114) / 255
		const max = Math.max(r, g, b)
		const min = Math.min(r, g, b)
		if (max === min) continue
		const d = max - min
		const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
		const w = (d / max) ** 2 * (max / 255 > 0.25 ? max / 255 : 0)
		const bin = bins[Math.floor(h * 2) % 12]
		bin.w += w
		bin.hue += h * 60 * w
	}
	const top = bins.reduce((x, y) => (y.w > x.w ? y : x))
	return {
		hue: top.w < 0.5 ? FALLBACK_HUE : Math.round(top.hue / top.w),
		lum: lum / count,
		clear: clear / count,
	}
}

export const scrimFor = (lum: number) => Math.min(0.72, 0.36 + Math.max(0, lum - 0.3) * 0.9)

export const inks = (hue: number) => ({
	"--ink-2": `hsl(${hue} 30% 87%)`,
	"--ink-3": `hsl(${hue} 20% 72%)`,
	"--ink-dim": `hsl(${hue} 14% 56%)`,
	"--ink-4": `hsl(${hue} 10% 48%)`,
})

export function accentHex(hue: number): string {
	const s = 0.7
	const l = 0.5
	const channel = (n: number) => {
		const k = (n + hue / 30) % 12
		const value = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, "0")
	}
	return `#${channel(0)}${channel(8)}${channel(4)}`
}
