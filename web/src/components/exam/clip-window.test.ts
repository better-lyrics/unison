import { describe, expect, it } from "vitest"
import { clampToWindow, reachedWindowEnd, shouldRestart } from "./clip-window"

describe("clampToWindow", () => {
  it("leaves a time inside the window unchanged", () => {
    expect(clampToWindow(40, 30, 45)).toBe(40)
  })

  it("pulls a time before the start up to the start", () => {
    expect(clampToWindow(10, 30, 45)).toBe(30)
  })

  it("pulls a time past the end back to the end", () => {
    expect(clampToWindow(90, 30, 45)).toBe(45)
  })

  describe("edge cases", () => {
    it("with no end, only floors at the start", () => {
      expect(clampToWindow(500, 30)).toBe(500)
      expect(clampToWindow(5, 30)).toBe(30)
    })

    it("start of zero passes real seconds through", () => {
      expect(clampToWindow(12.5, 0, 45)).toBe(12.5)
    })

    it("returns the boundary exactly at start or end", () => {
      expect(clampToWindow(30, 30, 45)).toBe(30)
      expect(clampToWindow(45, 30, 45)).toBe(45)
    })
  })
})

describe("shouldRestart", () => {
  it("restarts when the head is before the window", () => {
    expect(shouldRestart(10, 30, 45)).toBe(true)
  })

  it("resumes in place when the head is inside the window", () => {
    expect(shouldRestart(40, 30, 45)).toBe(false)
  })

  it("restarts once the head reaches or passes the end", () => {
    expect(shouldRestart(45, 30, 45)).toBe(true)
    expect(shouldRestart(50, 30, 45)).toBe(true)
  })

  describe("edge cases", () => {
    it("with no end, restarts only before the start", () => {
      expect(shouldRestart(5, 30)).toBe(true)
      expect(shouldRestart(500, 30)).toBe(false)
    })
  })
})

describe("reachedWindowEnd", () => {
  it("is false before the end", () => {
    expect(reachedWindowEnd(44.9, 45)).toBe(false)
  })

  it("is true at or past the end", () => {
    expect(reachedWindowEnd(45, 45)).toBe(true)
    expect(reachedWindowEnd(46, 45)).toBe(true)
  })

  describe("edge cases", () => {
    it("is always false when there is no end bound", () => {
      expect(reachedWindowEnd(0, undefined)).toBe(false)
      expect(reachedWindowEnd(9999, undefined)).toBe(false)
    })
  })
})
