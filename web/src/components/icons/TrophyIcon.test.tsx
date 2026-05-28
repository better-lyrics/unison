import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TrophyIcon } from "./TrophyIcon"

afterEach(() => cleanup())

describe("TrophyIcon", () => {
	it("renders an svg with currentColor fill and the given className", () => {
		const { container } = render(<TrophyIcon className="size-4 text-unison-medal-gold" />)
		const svg = container.querySelector("svg")
		expect(svg).not.toBeNull()
		expect(svg?.getAttribute("class")).toContain("size-4")
		expect(svg?.getAttribute("class")).toContain("text-unison-medal-gold")
		expect(svg?.getAttribute("viewBox")).toBe("0 0 1024 1024")
		const fills = Array.from(svg?.querySelectorAll("path") ?? []).map((p) => p.getAttribute("fill"))
		expect(fills.every((f) => f === "currentColor")).toBe(true)
	})

	it("is aria-hidden by default", () => {
		const { container } = render(<TrophyIcon />)
		expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
	})
})
