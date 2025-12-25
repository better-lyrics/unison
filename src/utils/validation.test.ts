import { describe, expect, it } from "vitest"
import { detectSyncType, validateTtmlStructure } from "./validation"

describe("validateTtmlStructure", () => {
	it("validates basic TTML structure", () => {
		const ttml = "<tt><body><div><p>Test</p></div></body></tt>"
		expect(validateTtmlStructure(ttml)).toBe(true)
	})

	it("validates TTML with namespace", () => {
		const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>Test</p></div></body></tt>`
		expect(validateTtmlStructure(ttml)).toBe(true)
	})

	it("validates TTML with attributes", () => {
		const ttml = `<tt lang="en"><body><div><p begin="00:00.000">Test</p></div></body></tt>`
		expect(validateTtmlStructure(ttml)).toBe(true)
	})

	it("rejects missing tt root", () => {
		const ttml = "<body><div><p>Test</p></div></body>"
		expect(validateTtmlStructure(ttml)).toBe(false)
	})

	it("rejects missing closing tt", () => {
		const ttml = "<tt><body><div><p>Test</p></div></body>"
		expect(validateTtmlStructure(ttml)).toBe(false)
	})

	it("rejects empty body without div or p", () => {
		const ttml = "<tt></tt>"
		expect(validateTtmlStructure(ttml)).toBe(false)
	})

	it("accepts self-closing body", () => {
		const ttml = "<tt><body/></tt>"
		expect(validateTtmlStructure(ttml)).toBe(true)
	})

	it("is case insensitive", () => {
		const ttml = "<TT><BODY><DIV><P>Test</P></DIV></BODY></TT>"
		expect(validateTtmlStructure(ttml)).toBe(true)
	})
})

describe("detectSyncType", () => {
	it("detects richsync (word-level timing)", () => {
		const ttml = `<tt><body><div><p begin="00:00.000" end="00:05.000"><span begin="00:00.000" end="00:01.000">Hello</span> <span begin="00:01.000" end="00:02.000">world</span></p></div></body></tt>`
		expect(detectSyncType(ttml)).toBe("richsync")
	})

	it("detects linesync (line-level timing on p)", () => {
		const ttml = `<tt><body><div><p begin="00:00.000" end="00:05.000">Hello world</p></div></body></tt>`
		expect(detectSyncType(ttml)).toBe("linesync")
	})

	it("detects linesync (line-level timing on div)", () => {
		const ttml = `<tt><body><div begin="00:00.000" end="00:05.000"><p>Hello world</p></div></body></tt>`
		expect(detectSyncType(ttml)).toBe("linesync")
	})

	it("detects plain (no timing)", () => {
		const ttml = "<tt><body><div><p>Hello world</p></div></body></tt>"
		expect(detectSyncType(ttml)).toBe("plain")
	})

	it("prioritizes richsync over linesync", () => {
		const ttml = `<tt><body><div><p begin="00:00.000"><span begin="00:00.000" end="00:01.000">Hello</span></p></div></body></tt>`
		expect(detectSyncType(ttml)).toBe("richsync")
	})

	it("is case insensitive", () => {
		const ttml = `<TT><BODY><DIV><P BEGIN="00:00.000" END="00:05.000">Test</P></DIV></BODY></TT>`
		expect(detectSyncType(ttml)).toBe("linesync")
	})
})
