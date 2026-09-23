import { describe, expect, it } from "vitest"
import { type JevGate, disabledJevGate, runJevStep } from "./jev-gate"

const input = {
	lyricsId: 7,
	song: "Amazing Grace",
	artist: "Traditional",
	diff: "-[00:12.00] Amazing grace! How sweet the sound\n+[00:12.00] Amazing grace! How soft the sound",
}

describe("runJevStep", () => {
	it("is a no-op when the gate is disabled", async () => {
		expect(await runJevStep(disabledJevGate, input)).toEqual({ flagged: false, probability: null })
	})

	it("passes a verdict through", async () => {
		const flagging: JevGate = { check: async () => ({ flagged: true, probability: 0.82 }) }
		expect(await runJevStep(flagging, input)).toEqual({ flagged: true, probability: 0.82 })
	})

	describe("regressions", () => {
		it("regression: a failing gate is treated as not flagged instead of blocking the edit", async () => {
			const failing: JevGate = {
				check: async () => {
					throw new Error("TypeSafe returned 503")
				},
			}
			expect(await runJevStep(failing, input)).toEqual({ flagged: false, probability: null })
		})
	})
})
