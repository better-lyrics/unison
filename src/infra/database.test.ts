import { describe, expect, it } from "vitest"
import { isUniqueViolation } from "./database"

describe("isUniqueViolation", () => {
	it("recognises a Postgres unique violation", () => {
		expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true)
	})

	it("recognises a plain error object carrying the code", () => {
		expect(isUniqueViolation({ code: "23505" })).toBe(true)
	})

	describe("edge cases", () => {
		it("rejects other Postgres error codes", () => {
			expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false)
		})

		it.each([null, undefined, "23505", 23505, {}, new Error("plain")])(
			"rejects a non-violation value %s",
			(value) => {
				expect(isUniqueViolation(value)).toBe(false)
			}
		)
	})
})
