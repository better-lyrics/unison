import { describe, expect, it } from "vitest"
import { languageName } from "./language"

describe("languageName", () => {
  it("falls back to the uppercased code instead of throwing on a bad tag", () => {
    expect(languageName("zz-invalid-tag-!")).toBe("ZZ-INVALID-TAG-!")
  })
})
