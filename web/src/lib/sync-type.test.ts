import { describe, expect, it } from "vitest"
import * as server from "../../../src/utils/sync-type"
import { SYNC_KINDS, syncTypeFor } from "./sync-type"

describe("sync type parity with the server", () => {
  it("names each lyric's sync kind and its look the same way on the web and the server", () => {
    for (const sync of ["richsync", "linesync", "plain"] as const) {
      for (const format of ["ttml", "TTML", "lrc", "plain", null]) {
        expect(server.syncTypeFor(sync, format)).toBe(syncTypeFor(sync, format))
      }
    }
    for (const [kind, look] of Object.entries(server.SYNC_KINDS)) {
      const web = SYNC_KINDS[kind as keyof typeof SYNC_KINDS]
      expect(look.label).toBe(web.label)
      expect(look.tint).toBe(web.tint)
      expect(look.color).toBe(web.color.startsWith("var(--ink") ? null : web.color)
    }
  })
})
