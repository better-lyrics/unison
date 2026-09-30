import { metadataItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { changedFields } from "./council-metadata"

const BEFORE = { song: "Isn't She Lovely", artist: "Stevie Wonder", album: null }

describe("changedFields", () => {
  it("names each field the proposal changes, in display order", () => {
    const item = metadataItem({
      before: BEFORE,
      proposed: { song: "Isn't She Lovely (Live)", artist: "Stevie Wonder & Friends", album: "Live" },
    })
    expect(changedFields(item)).toEqual(["Title", "Artist", "Album"])
  })

  describe("edge cases", () => {
    it("treats an album going from none to a value as a change", () => {
      expect(changedFields(metadataItem({ before: BEFORE, proposed: { ...BEFORE, album: "LP" } }))).toEqual([
        "Album",
      ])
    })

    it("treats removing the album as a change", () => {
      const item = metadataItem({ before: { ...BEFORE, album: "LP" }, proposed: BEFORE })
      expect(changedFields(item)).toEqual(["Album"])
    })

    it("returns nothing when the values match", () => {
      expect(changedFields(metadataItem({ before: BEFORE, proposed: BEFORE }))).toEqual([])
    })

    it("counts a case-only change", () => {
      const item = metadataItem({ before: BEFORE, proposed: { ...BEFORE, song: "isn't she lovely" } })
      expect(changedFields(item)).toEqual(["Title"])
    })
  })
})
