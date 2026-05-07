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

describe("detectSyncType TTML", () => {
	it("detects richsync from spans with begin and end inside p", () => {
		const ttml = `<tt><body><div><p begin="00:00.000" end="00:05.000"><span begin="00:00.000" end="00:01.000">Hello</span> <span begin="00:01.000" end="00:02.000">world</span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("richsync")
	})

	it("detects linesync when only p has begin/end", () => {
		const ttml = `<tt><body><div><p begin="00:00.000" end="00:05.000">Hello world</p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("linesync")
	})

	it("detects plain when no p or span has timing", () => {
		const ttml = "<tt><body><div><p>Hello world</p><p>Second line</p></div></body></tt>"
		expect(detectSyncType(ttml, "ttml")).toBe("plain")
	})

	it("returns linesync when first p has timing but later p does not", () => {
		const ttml = `<tt><body><div><p begin="00:00.000" end="00:02.000">Line one</p><p>Line two</p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("linesync")
	})

	it("returns linesync when only the last p has timing (any line wins)", () => {
		const ttml = `<tt><body><div><p>Line one</p><p begin="00:02.000" end="00:04.000">Line two</p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("linesync")
	})

	it("returns richsync when any span anywhere has begin and end (mixed lines)", () => {
		const ttml = `<tt><body><div><p begin="0:00.0" end="0:02.0">Line one</p><p begin="0:02.0" end="0:04.0"><span begin="0:02.0" end="0:02.5">Line</span> <span begin="0:02.5" end="0:04.0">two</span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("richsync")
	})

	it("counts spans nested inside ttm:role x-bg background containers", () => {
		const ttml = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="0:00.0" end="0:02.0">Line<span ttm:role="x-bg"><span begin="0:00.5" end="0:01.0">bg</span></span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("richsync")
	})

	it("returns plain when a span has only begin or only end (incomplete word timing)", () => {
		const ttml = `<tt><body><div><p><span begin="0:00.0">half timed</span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("plain")
	})

	it("classifies the user's id=208 doc shape as richsync (composer:timing word + bg spans)", () => {
		const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:composer="https://composer.boidu.dev/ttml" composer:timing="Word"><body><div><p begin="0:01.428" end="0:04.847" ttm:agent="v2000"><span begin="0:01.428" end="0:01.731">Whoa,</span> <span begin="0:01.731" end="0:02.577">oh,</span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("richsync")
	})

	it("classifies a doc with undeclared namespace prefix correctly (declareMissingNamespaces)", () => {
		const ttml = `<tt><body><div><p composer:timing="Word" begin="0:00.0" end="0:02.0"><span begin="0:00.0" end="0:01.0">Hello</span> <span begin="0:01.0" end="0:02.0">world</span></p></div></body></tt>`
		expect(detectSyncType(ttml, "ttml")).toBe("richsync")
	})

	it("returns plain on malformed/unparseable TTML rather than throwing", () => {
		const ttml = "<tt><body><div><p>unclosed"
		expect(detectSyncType(ttml, "ttml")).toBe("plain")
	})
})

describe("detectSyncType LRC", () => {
	it("detects richsync from inline word markers (A2/enhanced LRC)", () => {
		const lrc = "[00:15.00]Hello <00:15.50>world\n[00:18.00]Second line"
		expect(detectSyncType(lrc, "lrc")).toBe("richsync")
	})

	it("detects linesync when only line tags exist", () => {
		const lrc = "[00:15.00]Hello world\n[00:18.50]Second line"
		expect(detectSyncType(lrc, "lrc")).toBe("linesync")
	})

	it("detects plain when no timestamps exist", () => {
		const lrc = "Just text\nNo timestamps here"
		expect(detectSyncType(lrc, "lrc")).toBe("plain")
	})

	it("accepts colon as fractional separator on word markers", () => {
		const lrc = "[00:15:00]Hello <00:15:50>world"
		expect(detectSyncType(lrc, "lrc")).toBe("richsync")
	})

	it("accepts 3-digit milliseconds on word markers", () => {
		const lrc = "[00:15.000]Hello <00:15.500>world"
		expect(detectSyncType(lrc, "lrc")).toBe("richsync")
	})
})

describe("detectSyncType plain format", () => {
	it("returns plain regardless of content", () => {
		expect(detectSyncType("Just lyrics with no timing", "plain")).toBe("plain")
	})

	it("returns plain even when content contains TTML-looking tags", () => {
		expect(detectSyncType('<p begin="00:00.000">Trick</p>', "plain")).toBe("plain")
	})

	it("returns plain even when content contains LRC-looking tags", () => {
		expect(detectSyncType("[00:00.000]Trick", "plain")).toBe("plain")
	})
})
