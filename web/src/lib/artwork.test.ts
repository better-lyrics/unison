import { describe, expect, it } from "vitest"
import { youtubeThumbnailFallbackUrl, youtubeThumbnailUrl } from "@/lib/artwork"

describe("youtube thumbnail urls", () => {
  it("builds maxres and hq fallback urls", () => {
    expect(youtubeThumbnailUrl("abc123")).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg")
    expect(youtubeThumbnailFallbackUrl("abc123")).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg")
  })
})
