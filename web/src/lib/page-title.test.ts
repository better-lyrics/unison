import { describe, expect, it } from "vitest"
import * as server from "../../../src/utils/page-title"
import { PAGE_TITLES, profileTitle, songTitle, titleForPath } from "./page-title"

describe("page titles", () => {
  it("match the server's share titles", () => {
    expect(PAGE_TITLES).toEqual(server.PAGE_TITLES)
    expect(songTitle("Harbour Lights", "Wren Atlas")).toBe(server.songTitle("Harbour Lights", "Wren Atlas"))
    expect(profileTitle("Odo")).toBe(server.profileTitle("Odo"))
  })

  it("leaves pages that load their own title alone", () => {
    expect(titleForPath("/song/abc")).toBeNull()
    expect(titleForPath("/u/odo")).toBeNull()
    expect(titleForPath("/curator/k1")).toBeNull()
    expect(titleForPath("/curators")).toBe(PAGE_TITLES.leaderboard)
    expect(titleForPath("/council/flags")).toBe("Council · Unison")
  })
})
