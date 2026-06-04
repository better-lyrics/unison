import { cleanup, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { YouTubeEmbed } from "./YouTubeEmbed"

afterEach(() => cleanup())

describe("YouTubeEmbed", () => {
  it("renders a div with aspect-video sizing", () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(<YouTubeEmbed playerRef={ref} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toMatch(/aspect-video/)
    expect(wrapper.className).toMatch(/w-full/)
  })

  it("attaches the passed ref to the mount node", () => {
    const ref = createRef<HTMLDivElement>()
    render(<YouTubeEmbed playerRef={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLElement)
  })

  it("mounts and unmounts without throwing", () => {
    const ref = createRef<HTMLDivElement>()
    const { unmount } = render(<YouTubeEmbed playerRef={ref} />)
    expect(() => unmount()).not.toThrow()
  })
})
