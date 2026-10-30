import { strikeNote } from "@/db/vote-strikes"
import { describe, expect, it } from "vitest"

const base = { kind: "ring", keyCount: 59, voteCount: 63, repeat: false, backfill: false }

describe("strikeNote", () => {
	it("names the kind, key count and vote count", () => {
		expect(strikeNote(base)).toBe("ring: 59 keys, 63 votes")
	})

	it("marks a repeat strike", () => {
		expect(strikeNote({ ...base, repeat: true })).toBe("ring: 59 keys, 63 votes (repeat)")
	})

	it("marks a strike from history before launch", () => {
		expect(
			strikeNote({ kind: "both", keyCount: 3, voteCount: 20, repeat: false, backfill: true })
		).toBe("both: 3 keys, 20 votes (history before launch)")
	})

	describe("edge cases", () => {
		it("uses the singular for one key and one vote", () => {
			expect(strikeNote({ ...base, kind: "serial", keyCount: 1, voteCount: 1 })).toBe(
				"serial: 1 key, 1 vote"
			)
		})

		it("uses the singular key with plural votes", () => {
			expect(strikeNote({ ...base, kind: "serial", keyCount: 1, voteCount: 17 })).toBe(
				"serial: 1 key, 17 votes"
			)
		})

		it("uses the plural for zero", () => {
			expect(strikeNote({ ...base, keyCount: 0, voteCount: 0 })).toBe("ring: 0 keys, 0 votes")
		})
	})
})
