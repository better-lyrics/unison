import { describe, expect, it } from "vitest"
import { isProfane } from "./profanity"

describe("isProfane", () => {
	it("returns false for clean names", () => {
		expect(isProfane("Alex")).toBe(false)
		expect(isProfane("BrightVivaceRoll")).toBe(false)
		expect(isProfane("NormalName")).toBe(false)
	})

	it("does not false-positive on substring matches", () => {
		expect(isProfane("Hassan")).toBe(false)
		expect(isProfane("assassin")).toBe(false)
		expect(isProfane("classic")).toBe(false)
	})

	it("rejects obvious profanity", () => {
		expect(isProfane("fuck")).toBe(true)
		expect(isProfane("FuckYou")).toBe(true)
	})

	it("rejects leetspeak variants", () => {
		expect(isProfane("sh1t")).toBe(true)
	})
})
