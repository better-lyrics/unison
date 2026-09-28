import { describe, expect, it } from "vitest"
import { isVideoId } from "../../../src/utils/video-id"
import { videoIdFromInput, youTubeMusicUrl } from "./youtube-music"

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

describe("videoIdFromInput", () => {
  it("reads the id from a YouTube Music link", () => {
    expect(videoIdFromInput("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM")).toBe("dQw4w9WgXcQ")
  })

  it("reads the id from YouTube and short links", () => {
    expect(videoIdFromInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(videoIdFromInput("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(videoIdFromInput("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ")
  })

  it("accepts a bare video id", () => {
    expect(videoIdFromInput("a-b_c123456")).toBe("a-b_c123456")
  })

  describe("edge cases", () => {
    it("ignores surrounding whitespace", () => {
      expect(videoIdFromInput("  https://youtu.be/dQw4w9WgXcQ \n")).toBe("dQw4w9WgXcQ")
    })

    it("accepts a link without the scheme", () => {
      expect(videoIdFromInput("music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    })

    it("returns null for plain search text", () => {
      expect(videoIdFromInput("never gonna")).toBeNull()
      expect(videoIdFromInput("")).toBeNull()
    })

    it("returns null for a link to another site or with a malformed id", () => {
      expect(videoIdFromInput("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull()
      expect(videoIdFromInput("https://music.youtube.com/watch?v=short")).toBeNull()
      expect(videoIdFromInput("https://music.youtube.com/browse/UC123")).toBeNull()
    })
  })
})

describe("invariants", () => {
  it("accepts a bare id exactly when the server does", () => {
    const samples = ["dQw4w9WgXcQ", "a-b_c123456", "short", "dQw4w9WgXcQx", "dQw4w9WgXc!", "", "never gonna"]
    for (const sample of samples) expect(videoIdFromInput(sample) === sample).toBe(isVideoId(sample))
  })
})
