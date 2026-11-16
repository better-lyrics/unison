import { describe, expect, it } from "vitest"
import { creditLine } from "./editor-credit"

const text = (names: string[], shown?: number) =>
	creditLine(names, shown)
		.map((p) => p.text)
		.join("")

describe("creditLine", () => {
	it("names one, two, or two and a count", () => {
		expect(text(["Mirelle"])).toBe("Mirelle")
		expect(text(["Mirelle", "Cass"])).toBe("Mirelle and Cass")
		expect(text(["Mirelle", "Cass", "Juno", "Pell"])).toBe("Mirelle, Cass and 2 more")
	})

	it("marks names as strong and drops to one name when asked", () => {
		expect(creditLine(["Mirelle", "Cass", "Juno"], 1)).toEqual([
			{ text: "Mirelle", strong: true },
			{ text: " and 2 more", strong: false },
		])
	})
})
