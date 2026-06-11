import { iso6393To1 } from "iso-639-3"

const FRANC_INDIVIDUAL_TO_639_1: Record<string, string> = {
	cmn: "zh",
	arb: "ar",
	pes: "fa",
}

export function mapTo639_1(code639_3: string): string | null {
	if (!code639_3 || code639_3 === "und") return null
	const override = FRANC_INDIVIDUAL_TO_639_1[code639_3]
	if (override) return override
	const mapped = iso6393To1[code639_3]
	return mapped ?? code639_3
}
