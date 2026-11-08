import { describe, expect, it } from "vitest"
import { lyricFingerprint } from "./lyric-fingerprint"

const COMPACT = `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word"><head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head><body dur="12.000"><div><p begin="1.000" end="3.250" ttm:agent="v1"><span begin="1.000" end="1.400">Paper </span><span begin="1.400" end="2.100">lanterns </span><span begin="2.100" end="3.250">drift</span><span ttm:role="x-bg"><span begin="2.500" end="3.000">(slowly)</span></span></p></div></body></tt>`

const PRETTY = `<tt itunes:timing="Word" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns="http://www.w3.org/ns/ttml">
  <head>
    <metadata>
      <ttm:agent xml:id="v1" type="person" />
    </metadata>
  </head>
  <body dur="00:12.000">
    <div>
      <p ttm:agent="v1" end="00:03.250" begin="00:01.000">
        <span end="00:01.400" begin="00:01.000">Paper</span>
        <span begin="00:01.400" end="00:02.100">lanterns</span>
        <span begin="00:02.100" end="00:03.250">drift</span>
        <span ttm:role="x-bg">
          <span begin="00:02.500" end="00:03.000">(slowly)</span>
        </span>
      </p>
    </div>
  </body>
</tt>`

describe("lyricFingerprint", () => {
	it("ignores formatting, attribute order and time notation", () => {
		expect(lyricFingerprint(PRETTY, "ttml")).toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("ignores the length and video of the audio the lyrics were synced to", () => {
		const otherAudio = COMPACT.replace('<body dur="12.000">', '<body dur="12.417">').replace(
			"</metadata>",
			'<composer:meta key="ytVideoId" value="dQw4w9WgXcQ"/></metadata>'
		)
		expect(lyricFingerprint(otherAudio, "ttml")).toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("sees a word moved by a few milliseconds", () => {
		const nudged = COMPACT.replace('begin="1.400" end="2.100"', 'begin="1.430" end="2.100"')
		expect(lyricFingerprint(nudged, "ttml")).not.toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("sees a line given to another singer", () => {
		const reassigned = COMPACT.replace('ttm:agent="v1"', 'ttm:agent="v2"')
		expect(lyricFingerprint(reassigned, "ttml")).not.toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("reads the same time written in milliseconds, seconds or clock time", () => {
		const units = COMPACT.replace('begin="1.400" end="2.100"', 'begin="1400ms" end="2.1s"')
		expect(lyricFingerprint(units, "ttml")).toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("keeps the space of a spacer span between words", () => {
		const spaced = COMPACT.replace("Paper </span>", "Paper</span><span> </span>")
		const joined = COMPACT.replace("Paper </span>", "Paper</span><span></span>")
		expect(lyricFingerprint(spaced, "ttml")).not.toBe(lyricFingerprint(joined, "ttml"))
	})

	it("sees words joined that were apart", () => {
		const joined = COMPACT.replace("Paper </span>", "Paper</span>")
		expect(lyricFingerprint(joined, "ttml")).not.toBe(lyricFingerprint(COMPACT, "ttml"))
	})

	it("ignores line endings and trailing spaces in LRC", () => {
		const lrc = "[00:01.00]Paper lanterns drift\n[00:04.00]Over the river"
		expect(lyricFingerprint(`${lrc.replace("\n", "  \r\n")}\n`, "lrc")).toBe(
			lyricFingerprint(lrc, "lrc")
		)
	})
})
