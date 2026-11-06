import { describe, expect, it } from "vitest"
import * as server from "../../../src/utils/sleeve"
import { sleeveCss, sleeveHue, sleevePaint } from "./sleeve"

const SONGS: [string, string][] = [
  ["Paper Lanterns", "The Quiet Hours"],
  ["夜明けのメロディ", "Hoshino Rin"],
  ["밤하늘의 노래", "Lumi"],
  ["Sunburn 🌅", "Coastline Kids"],
  ["", ""],
]

describe("sleeve parity with the server", () => {
  it("gives every song the same hue, paint and css on the web and the server", () => {
    for (const [song, artist] of SONGS) {
      const hue = sleeveHue(song, artist)
      expect(server.sleeveHue(song, artist)).toBe(hue)
      expect(server.sleevePaint(hue)).toEqual(sleevePaint(hue))
      expect(server.sleeveCss(song, artist)).toBe(sleeveCss(song, artist))
    }
  })
})
