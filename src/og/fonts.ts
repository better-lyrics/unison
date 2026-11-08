import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { log } from "@/infra/logger"
import type { render } from "takumi-js"
import { type FontSubset, googleFonts } from "takumi-js/helpers"

type Fonts = NonNullable<NonNullable<Parameters<typeof render>[1]>["fonts"]>

const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url))

const CJK_TIMEOUT_MS = 5000

export const FONT_STACK = "Satoshi, Noto Sans JP, Noto Sans KR"
export const MONO_STACK = "JetBrains Mono"

let bundled: Promise<Fonts> | null = null
let cjk: Promise<FontSubset[]> | null = null

const BUNDLED = [
	{ name: "Satoshi", file: "satoshi", weights: [500, 700, 900] },
	{ name: MONO_STACK, file: "jetbrains-mono", weights: [500, 700] },
]

function loadBundled(): Promise<Fonts> {
	bundled ??= Promise.all(
		BUNDLED.flatMap(({ name, file, weights }) =>
			weights.map(async (weight) => ({
				name,
				weight,
				data: await readFile(`${FONT_DIR}${file}-${weight}.woff2`),
			}))
		)
	)
	return bundled
}

function loadCjk(): Promise<FontSubset[]> {
	cjk ??= googleFonts({
		families: [
			{ name: "Noto Sans JP", weight: [500, 900] },
			{ name: "Noto Sans KR", weight: [500, 900] },
		],
		timeout: CJK_TIMEOUT_MS,
	}).catch((error: unknown) => {
		log.warn("og cjk fonts failed", { error: (error as Error).message })
		cjk = null
		return []
	})
	return cjk
}

export async function ogFonts(): Promise<Fonts> {
	const [latin, rest] = await Promise.all([loadBundled(), loadCjk()])
	return [...latin, ...rest]
}
