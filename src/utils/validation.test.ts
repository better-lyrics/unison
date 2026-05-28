import { describe, expect, it } from "vitest"
import { detectFormat, detectPrettyPrintedTtml, detectSyncType, validateTtmlStructure } from "./validation"

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

describe("detectFormat", () => {
	describe("TTML detection", () => {
		it("detects minimal well-formed TTML", () => {
			expect(detectFormat("<tt><body><div><p>Hello</p></div></body></tt>")).toBe("ttml")
		})

		it("detects TTML with declared namespaces and timing", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0:00.0" end="0:02.0"><span begin="0:00.0" end="0:01.0">Hi</span></p></div></body></tt>`
			expect(detectFormat(ttml)).toBe("ttml")
		})

		it("detects TTML with self-closing body", () => {
			expect(detectFormat("<tt><body/></tt>")).toBe("ttml")
		})

		it("detects TTML when root tag has attributes", () => {
			expect(detectFormat(`<tt lang="en"><body><div><p>x</p></div></body></tt>`)).toBe("ttml")
		})

		it("TTML wins over LRC-looking line brackets in inner text", () => {
			const ttml = "<tt><body><div><p><span>[00:01.00]Hello</span></p></div></body></tt>"
			expect(detectFormat(ttml)).toBe("ttml")
		})

		it("TTML wins over raw LRC word markers inside a CDATA section", () => {
			const ttml =
				"<tt><body><div><p><![CDATA[Hello <00:01.00> world]]></p></div></body></tt>"
			expect(detectFormat(ttml)).toBe("ttml")
		})

		it("detects TTML prefixed by a UTF-8 BOM", () => {
			expect(detectFormat("﻿<tt><body><div><p>Hi</p></div></body></tt>")).toBe("ttml")
		})

		it("detects TTML preceded by an XML declaration prologue", () => {
			const ttml =
				'<?xml version="1.0" encoding="UTF-8"?><tt><body><div><p>Hi</p></div></body></tt>'
			expect(detectFormat(ttml)).toBe("ttml")
		})

		it("is case insensitive on the root element", () => {
			expect(detectFormat("<TT><BODY><DIV><P>x</P></DIV></BODY></TT>")).toBe("ttml")
		})
	})

	describe("LRC detection", () => {
		it("detects word-timed LRC", () => {
			expect(detectFormat("[00:15.00]Hello <00:15.50>world")).toBe("lrc")
		})

		it("detects line-timed LRC", () => {
			expect(detectFormat("[00:15.00]Hello world\n[00:18.00]Second")).toBe("lrc")
		})

		it("detects LRC with colon as fractional separator", () => {
			expect(detectFormat("[00:15:00]Hello <00:15:50>world")).toBe("lrc")
		})

		it("detects LRC with 3-digit milliseconds", () => {
			expect(detectFormat("[00:15.000]Hello world")).toBe("lrc")
		})

		it("detects LRC with CRLF line endings", () => {
			expect(detectFormat("[00:01.00]Line one\r\n[00:02.00]Line two")).toBe("lrc")
		})

		it("detects LRC mixed with metadata header lines", () => {
			const lrc = "[ar:Some Artist]\n[ti:Title]\n[00:15.00]Hello\n[00:18.00]World"
			expect(detectFormat(lrc)).toBe("lrc")
		})

		it("detects LRC even when prose precedes the first timestamp", () => {
			expect(detectFormat("Some intro\n[00:01.00]Line one")).toBe("lrc")
		})

		it("treats metadata-only LRC (no time-tagged lines) as plain", () => {
			expect(detectFormat("[ar:Some Artist]\n[ti:Title]")).toBe("plain")
		})
	})

	describe("plain fallback", () => {
		it("returns plain for prose without markers", () => {
			expect(detectFormat("Just lyrics with no timing\nAnother line")).toBe("plain")
		})

		it("returns plain for empty string", () => {
			expect(detectFormat("")).toBe("plain")
		})

		it("returns plain for whitespace only", () => {
			expect(detectFormat("   \n\t\n  ")).toBe("plain")
		})

		it("returns plain for malformed TTML missing closing root", () => {
			expect(detectFormat("<tt><body><div><p>unclosed")).toBe("plain")
		})

		it("returns plain for empty <tt></tt> (no body, div, or p)", () => {
			expect(detectFormat("<tt></tt>")).toBe("plain")
		})

		it("returns plain for prose containing angle brackets that aren't TTML", () => {
			expect(detectFormat("She said <I think so> and walked away")).toBe("plain")
		})

		it("returns plain for unicode prose without timing", () => {
			expect(detectFormat("こんにちは世界\n你好世界\nสวัสดี")).toBe("plain")
		})
	})

	describe("regression boundaries", () => {
		it("does not misclassify a malformed TTML doc with LRC tags as lrc", () => {
			// validateTtmlStructure rejects (no closing </tt>) but content also has [mm:ss.xx] -> lrc wins
			expect(detectFormat("<tt><body><p>[00:01.00]hi</p></body>")).toBe("lrc")
		})

		it("classifies pathological short input as plain", () => {
			expect(detectFormat("<")).toBe("plain")
			expect(detectFormat("[")).toBe("plain")
			expect(detectFormat("[00")).toBe("plain")
		})

		it("treats partial LRC-looking timestamps as plain", () => {
			// Missing closing bracket -> not a valid LRC line tag
			expect(detectFormat("[00:15.00 Hello world")).toBe("plain")
		})

		it("classifies the row-431 doc shape (TTML wrongly claimed as plain) as ttml", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="0:01.428" end="0:04.847"><span begin="0:01.428" end="0:01.731">Whoa,</span></p></div></body></tt>`
			expect(detectFormat(ttml)).toBe("ttml")
		})
	})
})

describe("detectPrettyPrintedTtml", () => {
	describe("clean TTML (should not flag)", () => {
		it("accepts single-line word-synced TTML", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:01.0">Hello</span> <span begin="0:01.0" end="0:02.0">world</span></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts TTML with newlines between line elements but not between spans", () => {
			const ttml =
				'<tt><body><div>\n<p><span begin="0:00.0" end="0:01.0">Hi</span></p>\n<p><span begin="0:02.0" end="0:03.0">There</span></p>\n</div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts line-sync TTML with no spans", () => {
			const ttml =
				'<tt><body><div>\n  <p begin="0:00.0" end="0:01.0">Hello world</p>\n</div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts adjacent spans with no whitespace (syllable run)", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:00.5">Hel</span><span begin="0:00.5" end="0:01.0">lo</span></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts background span containers (x-bg)", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:01.0">Hi</span> <span ttm:role="x-bg"><span begin="0:00.5" end="0:01.0">bg</span></span></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts self-closing spans", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:01.0"/> <span begin="0:01.0" end="0:02.0"/></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts a single-span line-sync wrap with trailing whitespace inside (no sibling span)", () => {
			const ttml =
				'<tt><body><div><p begin="0:00.0" end="0:02.0"><span begin="0:00.0" end="0:02.0">whole line text </span></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})

		it("accepts a single-span line-sync wrap with leading whitespace inside (no sibling span)", () => {
			const ttml =
				'<tt><body><div><p begin="0:00.0" end="0:02.0"><span begin="0:00.0" end="0:02.0"> whole line text</span></p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(true)
		})
	})

	describe("pretty-printed TTML (should flag)", () => {
		it("flags newline between span siblings", () => {
			const ttml =
				'<tt><body><div><p>\n<span begin="0:00.0" end="0:01.0">Hello</span>\n<span begin="0:01.0" end="0:02.0">world</span>\n</p></div></body></tt>'
			const result = detectPrettyPrintedTtml(ttml)
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.reason).toBe("inter-span-newline")
		})

		it("flags trailing whitespace inside a span (row-69 pattern)", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:01.0">Focus </span><span begin="0:01.0" end="0:02.0">Aim</span></p></div></body></tt>'
			const result = detectPrettyPrintedTtml(ttml)
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.reason).toBe("span-trailing-whitespace")
		})

		it("flags leading whitespace inside a span", () => {
			const ttml =
				'<tt><body><div><p><span begin="0:00.0" end="0:01.0">Hello</span><span begin="0:01.0" end="0:02.0"> world</span></p></div></body></tt>'
			const result = detectPrettyPrintedTtml(ttml)
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.reason).toBe("span-leading-whitespace")
		})

		it("flags row 69's exact shape", () => {
			const row69 =
				'<?xml version="1.0" ?>\n<tt xmlns="http://www.w3.org/ns/ttml">\n  <body>\n    <div>\n      <p begin="00:00:01.417" end="00:00:01.958">\n        <span begin="00:00:01.417" end="00:00:01.958">Focus </span>\n      </p>\n      <p begin="00:00:03.216" end="00:00:04.259">\n        <span begin="00:00:03.216" end="00:00:03.746">Ready </span>\n        <span ttm:role="x-bg">\n          <span begin="00:00:03.711" end="00:00:04.259">Ah </span>\n        </span>\n      </p>\n    </div>\n  </body>\n</tt>'
			const result = detectPrettyPrintedTtml(row69)
			expect(result.ok).toBe(false)
		})

		it("flags CRLF inter-span whitespace", () => {
			const ttml =
				'<tt><body><div><p>\r\n<span begin="0:00.0" end="0:01.0">a</span>\r\n<span begin="0:01.0" end="0:02.0">b</span>\r\n</p></div></body></tt>'
			expect(detectPrettyPrintedTtml(ttml).ok).toBe(false)
		})
	})

	describe("non-TTML content", () => {
		it("returns ok for plain prose (caller is expected to gate on detected format first)", () => {
			expect(detectPrettyPrintedTtml("just some prose").ok).toBe(true)
		})

		it("returns ok for LRC", () => {
			expect(detectPrettyPrintedTtml("[00:01.00]Hello\n[00:02.00]World").ok).toBe(true)
		})

		it("returns ok for empty string", () => {
			expect(detectPrettyPrintedTtml("").ok).toBe(true)
		})
	})
})
