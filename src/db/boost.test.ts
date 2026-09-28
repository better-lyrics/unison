import { describe, expect, it } from "vitest"
import { monthWindow } from "./boost"

const utc = (y: number, m: number, d = 1, h = 0, min = 0) => Date.UTC(y, m, d, h, min) / 1000

describe("monthWindow", () => {
	it("frames last month, this month and the next reset", () => {
		expect(monthWindow(Date.UTC(2026, 8, 29, 12))).toEqual({
			lastMonthStart: utc(2026, 7),
			monthStart: utc(2026, 8),
			resetsAt: utc(2026, 9),
		})
	})

	describe("edge cases", () => {
		it("rolls last month back into December across a year start", () => {
			expect(monthWindow(Date.UTC(2026, 0, 15))).toEqual({
				lastMonthStart: utc(2025, 11),
				monthStart: utc(2026, 0),
				resetsAt: utc(2026, 1),
			})
		})

		it("rolls the reset forward into January across a year end", () => {
			expect(monthWindow(Date.UTC(2026, 11, 31, 23, 59))).toEqual({
				lastMonthStart: utc(2026, 10),
				monthStart: utc(2026, 11),
				resetsAt: utc(2027, 0),
			})
		})

		it("puts an instant exactly at a month start in the new month", () => {
			expect(monthWindow(Date.UTC(2026, 2, 1))).toEqual({
				lastMonthStart: utc(2026, 1),
				monthStart: utc(2026, 2),
				resetsAt: utc(2026, 3),
			})
		})
	})

	describe("invariants", () => {
		it("keeps the three boundaries in order a month apart for every month of a year", () => {
			for (let m = 0; m < 12; m++) {
				const w = monthWindow(Date.UTC(2028, m, 10))
				expect(w.lastMonthStart).toBeLessThan(w.monthStart)
				expect(w.monthStart).toBeLessThan(w.resetsAt)
				expect(w.monthStart).toBe(utc(2028, m))
			}
		})
	})
})
