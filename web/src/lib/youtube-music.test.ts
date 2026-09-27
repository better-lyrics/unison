import { describe, expect, it } from "vitest"
import { youTubeMusicUrl } from "./youtube-music"

describe("youTubeMusicUrl", () => {
  it("links a video id to the YouTube Music player", () => {
    expect(youTubeMusicUrl("dQw4w9WgXcQ")).toBe("https://music.youtube.com/watch?v=dQw4w9WgXcQ")
  })

  describe("edge cases", () => {
    it("keeps the dash and underscore of real ids", () => {
      expect(youTubeMusicUrl("a-b_c1234567")).toBe("https://music.youtube.com/watch?v=a-b_c1234567")
    })

    it("encodes characters that would change the query", () => {
      expect(youTubeMusicUrl("x&list=y")).toBe("https://music.youtube.com/watch?v=x%26list%3Dy")
    })

    it("returns the bare player for an empty id", () => {
      expect(youTubeMusicUrl("")).toBe("https://music.youtube.com/watch?v=")
    })
  })
})
