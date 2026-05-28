import { describe, expect, it } from "vitest"
import { buildError, ErrorCode } from "./errors"

describe("buildError", () => {
	it("returns success: false, a short error title, a code, and a rich hint", () => {
		const result = buildError(ErrorCode.TTML_MALFORMED)
		expect(result.success).toBe(false)
		expect(result.code).toBe("TTML_MALFORMED")
		expect(typeof result.error).toBe("string")
		expect(result.error.length).toBeGreaterThan(0)
		expect(typeof result.hint).toBe("string")
		expect(result.hint.length).toBeGreaterThan(40)
	})

	it("every defined code has a non-empty error and a non-empty hint", () => {
		for (const code of Object.values(ErrorCode)) {
			const result = buildError(code)
			expect(result.code).toBe(code)
			expect(result.error.length).toBeGreaterThan(0)
			expect(result.hint.length).toBeGreaterThan(0)
		}
	})

	it("allows overriding the hint when context-specific guidance is useful", () => {
		const result = buildError(ErrorCode.MISSING_QUERY, {
			hint: "Provide 'q' for fuzzy search, or both 'song' and 'artist' for exact match.",
		})
		expect(result.hint).toContain("fuzzy search")
	})

	it("allows overriding the short error title", () => {
		const result = buildError(ErrorCode.NOT_FOUND, { error: "No lyrics found for this video" })
		expect(result.error).toBe("No lyrics found for this video")
		expect(result.code).toBe("NOT_FOUND")
	})

	it("error field is a single line (backwards-compatible single-string display)", () => {
		for (const code of Object.values(ErrorCode)) {
			const result = buildError(code)
			expect(result.error).not.toContain("\n")
		}
	})

	it("has a stable code for the nonce replay case", () => {
		const result = buildError(ErrorCode.NONCE_REPLAY)
		expect(result.code).toBe("NONCE_REPLAY")
		expect(result.error).toBe("Already received")
		expect(result.hint).toMatch(/already received/i)
	})

	it("has a stable code for the report-details-too-long case", () => {
		const result = buildError(ErrorCode.REPORT_DETAILS_TOO_LONG)
		expect(result.code).toBe("REPORT_DETAILS_TOO_LONG")
		expect(result.hint).toMatch(/1000 characters/i)
	})
})
