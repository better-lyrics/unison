import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { UserAvatar } from "./UserAvatar"

const KEY = "a".repeat(64)
const URL_A = "https://cdn.discordapp.com/avatars/1/stale.png?size=128"
const URL_B = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"

const srcOf = (container: HTMLElement) => container.querySelector("img")?.getAttribute("src")

afterEach(cleanup)

describe("UserAvatar", () => {
  it("renders the chosen picture", () => {
    const { container } = render(<UserAvatar avatarUrl={URL_B} keyId={KEY} className="size-7" />)
    expect(srcOf(container)).toBe(URL_B)
    expect(container.querySelector("img")?.className).toBe("size-7")
  })

  it("renders the generated picture when none is chosen", () => {
    const { container } = render(<UserAvatar avatarUrl={null} keyId={KEY} />)
    expect(srcOf(container)).toBe(dicebearThumbsDataUri(KEY))
  })

  describe("error paths", () => {
    it("falls back to the generated picture when the image fails to load", () => {
      const { container } = render(<UserAvatar avatarUrl={URL_A} keyId={KEY} />)
      fireEvent.error(container.querySelector("img") as HTMLImageElement)
      expect(srcOf(container)).toBe(dicebearThumbsDataUri(KEY))
    })

    it("tries a newly chosen picture after an earlier one failed", () => {
      const { container, rerender } = render(<UserAvatar avatarUrl={URL_A} keyId={KEY} />)
      fireEvent.error(container.querySelector("img") as HTMLImageElement)
      rerender(<UserAvatar avatarUrl={URL_B} keyId={KEY} />)
      expect(srcOf(container)).toBe(URL_B)
    })
  })
})
