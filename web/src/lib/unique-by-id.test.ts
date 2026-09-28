import { describe, expect, it } from "vitest"
import { uniqueById } from "./unique-by-id"

describe("uniqueById", () => {
  describe("happy path", () => {
    it("keeps the first occurrence of each id in order", () => {
      const rows = [
        { id: 1, v: "a" },
        { id: 2, v: "b" },
        { id: 1, v: "c" },
        { id: 3, v: "d" },
      ]
      expect(uniqueById(rows)).toEqual([
        { id: 1, v: "a" },
        { id: 2, v: "b" },
        { id: 3, v: "d" },
      ])
    })
  })

  describe("edge cases", () => {
    it("returns an empty list for an empty list", () => {
      expect(uniqueById([])).toEqual([])
    })

    it("treats id 0 as a real id", () => {
      expect(uniqueById([{ id: 0 }, { id: 0 }])).toEqual([{ id: 0 }])
    })
  })

  describe("invariants", () => {
    it("does not mutate the input", () => {
      const rows = [{ id: 1 }, { id: 1 }]
      uniqueById(rows)
      expect(rows).toHaveLength(2)
    })

    it("keeps the same object references", () => {
      const first = { id: 1 }
      expect(uniqueById([first, { id: 1 }])[0]).toBe(first)
    })
  })
})
