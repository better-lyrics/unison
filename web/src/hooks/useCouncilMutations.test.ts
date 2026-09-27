import { ME, OLA, applicant } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { withOpinion } from "./useCouncilMutations"

const base = applicant({ opinions: { support: [{ ...OLA }], object: [], notes: [], mine: null } })
const keys = (people: { keyId: string }[]) => people.map((p) => p.keyId)

describe("withOpinion", () => {
  it("adds me to the side I pick", () => {
    const next = withOpinion(base, ME, "object")
    expect(keys(next.opinions.object)).toEqual([ME.keyId])
    expect(keys(next.opinions.support)).toEqual([OLA.keyId])
    expect(next.opinions.mine).toBe("object")
  })

  it("moves me between sides and removes me for no stance", () => {
    const supported = withOpinion(base, ME, "support")
    const moved = withOpinion(supported, ME, "object")
    expect(keys(moved.opinions.support)).toEqual([OLA.keyId])
    expect(keys(moved.opinions.object)).toEqual([ME.keyId])
    const cleared = withOpinion(moved, ME, null)
    expect(cleared.opinions.object).toEqual([])
    expect(cleared.opinions.mine).toBeNull()
  })

  describe("invariants", () => {
    it("never lists me twice and leaves the input untouched", () => {
      const twice = withOpinion(withOpinion(base, ME, "support"), ME, "support")
      expect(keys(twice.opinions.support)).toEqual([OLA.keyId, ME.keyId])
      expect(keys(base.opinions.support)).toEqual([OLA.keyId])
      expect(base.opinions.mine).toBeNull()
    })
  })
})
