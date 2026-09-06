import { config } from "@/config"
import { describe, expect, it } from "vitest"
import { PROVEN_EXPR_JOINED, RANKING_EXPR, RANKING_EXPR_JOINED } from "./predicates"

describe("ranking expression committee bonus", () => {
	it("adds the committee approval bonus to the joined expression", () => {
		expect(RANKING_EXPR_JOINED).toContain("committee_approved_at IS NOT NULL")
		expect(RANKING_EXPR_JOINED).toContain(`${config.gamification.boost.rankingBonus}`)
	})

	it("applies the bonus before the sync-type multiply so the boost scales it", () => {
		const bonusAt = RANKING_EXPR_JOINED.indexOf("committee_approved_at")
		const syncAt = RANKING_EXPR_JOINED.indexOf("sync_type")
		expect(bonusAt).toBeGreaterThanOrEqual(0)
		expect(syncAt).toBeGreaterThanOrEqual(0)
		expect(bonusAt).toBeLessThan(syncAt)
	})

	it("keeps the bonus additive, not folded into effective_score", () => {
		expect(RANKING_EXPR_JOINED).toContain("effective_score")
		expect(RANKING_EXPR_JOINED).toContain("LN(")
	})

	describe("regressions", () => {
		it("regression: the unprefixed expression never references committee_approved_at", () => {
			expect(RANKING_EXPR).not.toContain("committee_approved_at")
		})
	})
})

describe("proven expression committee branch", () => {
	it("treats committee approval as proof of eligibility", () => {
		expect(PROVEN_EXPR_JOINED).toContain("committee_approved_at IS NOT NULL")
	})
})
