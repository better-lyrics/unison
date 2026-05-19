import { describe, expect, it } from "vitest"
import { generatePetName } from "./petname"

describe("generatePetName", () => {
	it("is deterministic for the same keyId", () => {
		const keyId = "a".repeat(64)
		expect(generatePetName(keyId)).toBe(generatePetName(keyId))
	})

	it("returns a non-empty string for different keyIds", () => {
		expect(generatePetName("0".repeat(64)).length).toBeGreaterThan(0)
		expect(generatePetName("f".repeat(64)).length).toBeGreaterThan(0)
	})

	it("pins the exact name for a known keyId so word lists stay in sync", () => {
		// adjIndex = 0x00 % 64 = 0 -> "Melodic"
		// nounIndex = 0x01 % 64 = 1 -> "Guitar"
		// actionIndex = 0x02 % 64 = 2 -> "Groove"
		const keyId = `000102${"0".repeat(58)}`
		expect(generatePetName(keyId)).toBe("MelodicGuitarGroove")
	})
})
