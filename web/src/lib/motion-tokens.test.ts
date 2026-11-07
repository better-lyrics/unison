import { afterEach, expect, it } from "vitest"
import { tokenMs } from "./motion-tokens"

afterEach(() => document.documentElement.style.removeProperty("--test-dur"))

it("regression: reads a duration the CSS minifier rewrote to seconds", () => {
  document.documentElement.style.setProperty("--test-dur", ".25s")
  expect(tokenMs("--test-dur", 0)).toBe(250)
})
