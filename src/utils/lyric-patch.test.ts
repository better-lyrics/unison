import { config } from "@/config"
import { describe, expect, it } from "vitest"
import { type DecisionInput, councilDecidesAt, decisionRole } from "./lyric-patch"

const OWNER = 1
const AUTHOR = 2
const COUNCIL = 3
const CREATED = 1_700_000_000
const INSIDE_WINDOW = CREATED + 60
const AFTER_WINDOW = CREATED + config.revisions.ownerDecisionSec + 1

const suggestion: DecisionInput = {
	action: "approve",
	reviewerId: COUNCIL,
	isCouncil: true,
	submitterId: OWNER,
	authorId: AUTHOR,
	reason: "suggested",
	sealed: false,
	ownerless: false,
	createdAt: CREATED,
	now: INSIDE_WINDOW,
}

describe("decisionRole", () => {
	it("never lets the author decide their own suggestion, even from the council", () => {
		for (const action of ["approve", "reject"] as const) {
			expect(
				decisionRole({ ...suggestion, action, reviewerId: AUTHOR, now: AFTER_WINDOW })
			).toEqual({ ok: false, reason: "own_patch" })
		}
	})

	it("lets the owner approve only a suggested edit on an unsealed lyric", () => {
		const owner = { ...suggestion, reviewerId: OWNER, isCouncil: false }
		expect(decisionRole(owner)).toEqual({ ok: true, role: "owner" })
		expect(decisionRole({ ...owner, reason: "large_text_drift" })).toEqual({
			ok: false,
			reason: "not_committee",
		})
		expect(decisionRole({ ...owner, sealed: true })).toEqual({
			ok: false,
			reason: "not_committee",
		})
	})

	it("leaves approval on a lyric with no owner to the council, even for its submitting account", () => {
		const community = { ...suggestion, reviewerId: OWNER, isCouncil: false, ownerless: true }
		expect(decisionRole(community)).toEqual({ ok: false, reason: "not_committee" })
		expect(decisionRole({ ...community, action: "reject" })).toEqual({ ok: true, role: "owner" })
	})

	it("lets the owner reject a suggestion held for any reason", () => {
		const reject = { ...suggestion, action: "reject" as const, reviewerId: OWNER, isCouncil: false }
		expect(decisionRole({ ...reject, reason: "flagged", sealed: true })).toEqual({
			ok: true,
			role: "owner",
		})
	})

	it("gives an owner on the council the council role where the owner may not approve", () => {
		const owner = { ...suggestion, reviewerId: OWNER }
		expect(decisionRole({ ...owner, reason: "large_text_drift" })).toEqual({
			ok: true,
			role: "council",
		})
		expect(decisionRole({ ...owner, sealed: true })).toEqual({ ok: true, role: "council" })
	})

	it("keeps the council off a suggested edit until the owner's window closes", () => {
		expect(decisionRole(suggestion)).toEqual({ ok: false, reason: "owner_window" })
		expect(decisionRole({ ...suggestion, now: AFTER_WINDOW })).toEqual({
			ok: true,
			role: "council",
		})
	})

	it("refuses a stranger outside the council", () => {
		expect(
			decisionRole({ ...suggestion, reviewerId: 4, isCouncil: false, now: AFTER_WINDOW })
		).toEqual({ ok: false, reason: "not_committee" })
	})

	it("lets the council decide at once on a lyric with no owner who can act", () => {
		const ownerless = { ...suggestion, ownerless: true }
		expect(decisionRole(ownerless)).toEqual({ ok: true, role: "council" })
		expect(decisionRole({ ...ownerless, submitterId: null })).toEqual({
			ok: true,
			role: "council",
		})
		expect(councilDecidesAt("suggested", false, true, CREATED, INSIDE_WINDOW)).toBeNull()
	})
})
