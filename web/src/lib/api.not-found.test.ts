import { fetchRouter, jsonResponse } from "@/test/fetch-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchUserByHandle, isNotFound } from "./api"

const lookupError = async (response: () => Response | Promise<Response>) => {
  vi.stubGlobal("fetch", fetchRouter([{ match: () => true, respond: response }]).fn)
  return fetchUserByHandle("susiisthebest").then(
    () => null,
    (error: unknown) => error,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("isNotFound", () => {
  it("recognises a 404 from the API", async () => {
    expect(isNotFound(await lookupError(() => jsonResponse({ success: false, error: "Not found" }, 404)))).toBe(true)
  })

  describe("error paths", () => {
    it("does not treat a server error as not found", async () => {
      expect(isNotFound(await lookupError(() => jsonResponse({ success: false, error: "Boom" }, 500)))).toBe(false)
    })

    it("does not treat a network failure as not found", async () => {
      expect(isNotFound(await lookupError(() => Promise.reject(new TypeError("Failed to fetch"))))).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("ignores values that are not errors", () => {
      expect(isNotFound("HTTP 404 for /x")).toBe(false)
      expect(isNotFound(null)).toBe(false)
    })

    it("does not match a status that only starts with 404", () => {
      expect(isNotFound(new Error("HTTP 4040 for /x"))).toBe(false)
    })
  })
})
