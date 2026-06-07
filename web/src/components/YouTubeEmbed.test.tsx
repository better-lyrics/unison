import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { YouTubeEmbed } from "./YouTubeEmbed"

afterEach(() => cleanup())

describe("YouTubeEmbed", () => {
  it("renders a div with aspect-video sizing", () => {
    const { container } = render(<YouTubeEmbed playerRef={() => {}} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toMatch(/aspect-video/)
    expect(wrapper.className).toMatch(/w-full/)
  })

  it("invokes the callback ref with the mount node", () => {
    const setRef = vi.fn()
    render(<YouTubeEmbed playerRef={setRef} />)
    expect(setRef).toHaveBeenCalledWith(expect.any(HTMLElement))
  })

  it("mounts and unmounts without throwing", () => {
    const { unmount } = render(<YouTubeEmbed playerRef={() => {}} />)
    expect(() => unmount()).not.toThrow()
  })
})
