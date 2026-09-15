import { config } from "@/config"
import { describe, expect, it } from "vitest"
import {
	noServableSyncedVariantServes,
	PROVEN_EXPR_JOINED,
	RANKING_EXPR,
	RANKING_EXPR_JOINED,
	RANKING_EXPR_VARIANT,
	servableSyncedVariantServes,
} from "./predicates"

describe("ranking expression committee bonus", () => {
	it("adds the committee approval bonus to the variant-selection expression", () => {
		expect(RANKING_EXPR_VARIANT).toContain("committee_approved_at IS NOT NULL")
		expect(RANKING_EXPR_VARIANT).toContain(`${config.gamification.boost.rankingBonus}`)
	})

	it("applies the bonus before the sync-type multiply so the boost scales it", () => {
		const bonusAt = RANKING_EXPR_VARIANT.indexOf("committee_approved_at")
		const syncAt = RANKING_EXPR_VARIANT.indexOf("sync_type")
		expect(bonusAt).toBeGreaterThanOrEqual(0)
		expect(syncAt).toBeGreaterThanOrEqual(0)
		expect(bonusAt).toBeLessThan(syncAt)
	})

	it("keeps the bonus additive, not folded into effective_score", () => {
		expect(RANKING_EXPR_VARIANT).toContain("effective_score")
		expect(RANKING_EXPR_VARIANT).toContain("LN(")
	})

	describe("regressions", () => {
		it("regression: the unprefixed expression never references committee_approved_at", () => {
			expect(RANKING_EXPR).not.toContain("committee_approved_at")
		})
		it("regression: the joined song/artist-search expression is committee-bonus free", () => {
			expect(RANKING_EXPR_JOINED).not.toContain("committee_approved_at")
		})
	})
})

describe("proven expression committee branch", () => {
	it("treats committee approval as proof of eligibility", () => {
		expect(PROVEN_EXPR_JOINED).toContain("committee_approved_at IS NOT NULL")
	})
})

describe("servable synced variant predicate", () => {
	const served = servableSyncedVariantServes("lr.video_id")
	const notServed = noServableSyncedVariantServes("lr.video_id")

	it("tests the primary video and the linked videos as two separate branches", () => {
		expect(served).toContain("l.video_id = lr.video_id")
		expect(served).toContain("JOIN lyrics_video_ids lvi ON lvi.lyrics_id = l.id")
		expect(served).toContain("lvi.video_id = lr.video_id")
	})

	it("only counts servable synced variants", () => {
		expect(served).toContain("l.sync_type IN ('linesync', 'richsync')")
		expect(served).toContain("l.deleted_at IS NULL")
		expect(served).toContain("l.effective_score")
	})

	it("combines the two positive branches with OR for EXISTS callers", () => {
		expect(served.match(/EXISTS \(/g) ?? []).toHaveLength(2)
		expect(served).toContain("OR")
	})

	it("negates each branch and joins with AND for anti-join callers", () => {
		expect(notServed.match(/NOT EXISTS \(/g) ?? []).toHaveLength(2)
		expect(notServed).toContain("AND")
	})

	describe("regressions", () => {
		it("regression: never fuses the primary and link check into one OR-inside-a-subquery", () => {
			// The 24s leaderboard regression was `video_id = v OR id IN (SELECT ... lyrics_video_ids ...)`
			// inside a single correlated (NOT) EXISTS, which blocks the anti-join. Keep the branches split.
			expect(served).not.toContain("IN (SELECT lyrics_id FROM lyrics_video_ids")
			expect(notServed).not.toContain("IN (SELECT lyrics_id FROM lyrics_video_ids")
		})
	})
})
