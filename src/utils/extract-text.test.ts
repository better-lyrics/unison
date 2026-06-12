import { describe, expect, it } from "vitest"
import { extractPlainText } from "./extract-text"

describe("extractPlainText", () => {
	describe("plain format", () => {
		it("returns text as-is", () => {
			const text = "Hello world\nSecond line"
			expect(extractPlainText(text, "plain")).toBe(text)
		})

		it("handles empty string", () => {
			expect(extractPlainText("", "plain")).toBe("")
		})
	})

	describe("lrc format", () => {
		it("strips timestamps and joins lines", () => {
			const lrc = `[00:15.00]First line
[00:20.00]Second line
[00:25.00]Third line`

			const result = extractPlainText(lrc, "lrc")
			expect(result).toBe("First line\nSecond line\nThird line")
		})

		it("excludes empty timestamp lines", () => {
			const lrc = `[00:15.00]Line one
[00:20.00]
[00:25.00]Line three`

			const result = extractPlainText(lrc, "lrc")
			expect(result).toBe("Line one\nLine three")
		})

		it("ignores metadata tags", () => {
			const lrc = `[ar:Artist Name]
[ti:Song Title]
[00:15.00]Actual lyrics`

			const result = extractPlainText(lrc, "lrc")
			expect(result).toBe("Actual lyrics")
		})
	})

	describe("ttml format", () => {
		it("extracts lyric text from simple TTML", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" lang="en">
  <body>
    <div>
      <p begin="00:15.000" end="00:20.000">First line</p>
      <p begin="00:20.000" end="00:25.000">Second line</p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toBe("First line Second line")
		})

		it("extracts text from word-synced spans", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" lang="en">
  <body>
    <div>
      <p begin="00:15.000" end="00:20.000">
        <span begin="00:15.000" end="00:17.000">Hello </span>
        <span begin="00:17.000" end="00:20.000">world</span>
      </p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toContain("Hello")
			expect(result).toContain("world")
		})

		it("does not include timing values as text", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" lang="en" dur="03:30.000">
  <body dur="03:30.000">
    <div begin="00:00.000" end="03:30.000">
      <p begin="00:15.000" end="00:20.000">Only real lyrics</p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toBe("Only real lyrics")
			expect(result).not.toContain("00:15")
			expect(result).not.toContain("03:30")
		})

		it("extracts background lyric text", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" lang="en">
  <body>
    <div>
      <p begin="00:15.000" end="00:20.000">
        <span>Main lyrics </span>
        <span ttm:role="x-bg">
          <span>(background)</span>
        </span>
      </p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toContain("Main lyrics")
			expect(result).toContain("background")
		})

		it("extracts songwriter names from metadata", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" lang="en">
  <head>
    <metadata>
      <songwriters>
        <songwriter>Elton John</songwriter>
        <songwriter>Bernie Taupin</songwriter>
      </songwriters>
    </metadata>
  </head>
  <body>
    <div>
      <p begin="00:15.000" end="00:20.000">Some lyrics here</p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toContain("Elton John")
			expect(result).toContain("Bernie Taupin")
			expect(result).toContain("Some lyrics here")
		})

		it("does not include namespace prefixes or attribute names", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" timing="Line" lang="en">
  <body>
    <div songPart="Verse 1">
      <p begin="00:15.000" end="00:20.000" ttm:agent="v1">Lyrics text</p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toBe("Lyrics text")
			expect(result).not.toContain("songPart")
			expect(result).not.toContain("Verse")
			expect(result).not.toContain("agent")
			expect(result).not.toContain("timing")
			expect(result).not.toContain("Line")
		})

		it("handles real-world Cold Heart TTML structure", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" timing="Line" lang="en" dur="00:03:33.4970000">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <ttm:agent type="person" xml:id="v2"/>
      <songwriters>
        <songwriter>Elton John</songwriter>
        <songwriter>Bernie Taupin</songwriter>
      </songwriters>
    </metadata>
  </head>
  <body dur="00:03:33.4970000">
    <div begin="00:00:19.3880000" end="00:00:23.0780000" songPart="Verse 1">
      <p begin="00:00:19.3880000" end="00:00:23.0780000" ttm:agent="v1">
        <span begin="00:00:19.3880000" end="00:00:19.8980000">I </span>
        <span begin="00:00:19.8980000" end="00:00:20.7180000">feel </span>
        <span begin="00:00:20.7180000" end="00:00:21.3980000">the </span>
        <span begin="00:00:21.3980000" end="00:00:23.0780000">wave</span>
      </p>
    </div>
    <div begin="00:01:15.0000000" end="00:01:20.0000000" songPart="Chorus">
      <p begin="00:01:15.0000000" end="00:01:18.0000000" ttm:agent="v2">
        <span>Cold, cold heart</span>
      </p>
      <p begin="00:01:18.0000000" end="00:01:20.0000000" ttm:agent="v1" ttm:role="x-bg">
        <span>(Hardened by you)</span>
      </p>
    </div>
  </body>
</tt>`

			const result = extractPlainText(ttml, "ttml")

			// Should contain lyric words
			expect(result).toContain("feel")
			expect(result).toContain("wave")
			expect(result).toContain("Cold, cold heart")
			expect(result).toContain("Hardened by you")

			// Should contain songwriter names
			expect(result).toContain("Elton John")
			expect(result).toContain("Bernie Taupin")

			// Should NOT contain timing values, attribute names, or song parts
			expect(result).not.toContain("00:00:19")
			expect(result).not.toContain("tickRate")
			expect(result).not.toContain("songPart")
			expect(result).not.toContain("Verse")
			expect(result).not.toContain("Chorus")
			expect(result).not.toContain("agent")
			expect(result).not.toContain("v1")
			expect(result).not.toContain("v2")
			expect(result).not.toContain("person")
		})

		it("extracts from real-world iTunes TTML with nested songwriters", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="en"><head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/><ttm:agent type="group" xml:id="v3"/><ttm:agent type="other" xml:id="v2000"/><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" leadingSilence="0.160"><translations/><songwriters><songwriter>ANDREW MEECHAM</songwriter><songwriter>Bernie Taupin</songwriter><songwriter>Dean Meredith</songwriter><songwriter>Elton John</songwriter><songwriter>Nicholas Littlemore</songwriter><songwriter>Nick Littlemore</songwriter><songwriter>Peter Mayes</songwriter><songwriter>Sam Littlemore</songwriter></songwriters></iTunesMetadata></metadata></head><body dur="3:22.735"><div begin="1.683" end="10.727" itunes:songPart="Intro" ttm:agent="v2000"><p begin="1.683" end="2.421" itunes:key="L1" ttm:agent="v2000"><span begin="1.683" end="2.421">Oh</span></p><p begin="5.740" end="8.628" itunes:key="L2" ttm:agent="v2000"><span begin="5.740" end="6.264">You're</span> <span begin="6.264" end="6.879">my</span> <span begin="6.879" end="7.283">cold</span> <span begin="7.283" end="8.628">heart</span></p><p begin="9.944" end="10.727" itunes:key="L3" ttm:agent="v2000"><span begin="9.944" end="10.727">Oh</span></p></div><div begin="15.104" end="30.623" itunes:songPart="Verse"><p begin="15.104" end="17.970" itunes:key="L4" ttm:agent="v1"><span begin="15.104" end="15.366">It's</span> <span begin="15.366" end="15.685">a</span> <span begin="15.685" end="16.401">human</span> <span begin="16.401" end="17.970">sign</span></p><p begin="19.215" end="22.229" itunes:key="L5" ttm:agent="v1"><span begin="19.215" end="19.450">When</span> <span begin="19.450" end="20.148">things</span> <span begin="20.148" end="20.665">go</span> <span begin="20.665" end="22.229">wrong</span></p><p begin="23.371" end="26.379" itunes:key="L6" ttm:agent="v1"><span begin="23.371" end="23.686">When</span> <span begin="23.686" end="23.931">the</span> <span begin="23.931" end="24.247">scent</span> <span begin="24.247" end="24.491">of</span> <span begin="24.491" end="24.871">her</span> <span begin="24.871" end="25.353">lin</span><span begin="25.353" end="26.379">gers</span></p><p begin="27.270" end="30.623" itunes:key="L7" ttm:agent="v1"><span begin="27.270" end="27.629">And</span> <span begin="27.629" end="28.166">temp</span><span begin="28.166" end="28.433">ta</span><span begin="28.433" end="28.835">tion's</span> <span begin="28.835" end="30.623">strong</span></p></div><div begin="31.907" end="49.576" itunes:songPart="Verse"><p begin="31.907" end="34.423" itunes:key="L8" ttm:agent="v1"><span begin="31.907" end="32.530">Cold,</span> <span begin="32.530" end="33.131">cold</span> <span begin="33.131" end="34.423">heart</span></p><p begin="35.720" end="39.620" itunes:key="L9" ttm:agent="v1"><span begin="35.720" end="36.528">Hardened</span> <span begin="36.528" end="37.021">by</span> <span begin="37.021" end="38.644">you</span> <span ttm:role="x-bg"><span begin="38.944" end="39.620">(Oh)</span></span></p><p begin="39.822" end="43.673" itunes:key="L10" ttm:agent="v1"><span begin="39.822" end="40.226">Some</span> <span begin="40.226" end="40.824">things</span> <span begin="40.824" end="41.214">look</span> <span begin="41.214" end="42.195">better,</span> <span begin="42.353" end="42.729">ba</span><span begin="42.729" end="43.673">by</span></p><p begin="44.073" end="49.576" itunes:key="L11" ttm:agent="v1"><span begin="44.073" end="44.453">Just</span> <span begin="44.453" end="44.936">pas</span><span begin="44.936" end="45.462">sing</span> <span begin="45.462" end="47.076">through</span> <span ttm:role="x-bg"><span begin="47.421" end="47.845">(No-</span><span begin="47.845" end="48.072">no-</span><span begin="48.072" end="48.454">no,</span> <span begin="48.565" end="48.900">no-</span><span begin="48.900" end="49.576">no)</span></span></p></div><div begin="50.278" end="1:19.521" itunes:songPart="Chorus" ttm:agent="v2"><p begin="50.278" end="54.262" itunes:key="L12" ttm:agent="v2"><span begin="50.278" end="50.671">And</span> <span begin="50.671" end="50.869">I</span> <span begin="50.869" end="51.172">think</span> <span begin="51.172" end="51.425">it's</span> <span begin="51.425" end="51.935">gonna</span> <span begin="51.935" end="52.475">be</span> <span begin="52.475" end="52.791">a</span> <span begin="52.791" end="53.170">long,</span> <span begin="53.170" end="53.562">long</span> <span begin="53.562" end="54.262">time</span></p><p begin="54.262" end="58.703" itunes:key="L13" ttm:agent="v2"><span begin="54.262" end="54.764">Till</span> <span begin="54.764" end="55.303">touch</span><span begin="55.303" end="55.841">down</span> <span begin="55.841" end="56.299">brings</span> <span begin="56.299" end="56.577">me</span> <span begin="56.577" end="56.885">'round</span> <span begin="56.885" end="57.100">a</span><span begin="57.100" end="57.399">gain</span> <span begin="57.399" end="57.811">to</span> <span begin="57.811" end="58.703">find</span></p><p begin="58.803" end="1:02.531" itunes:key="L14" ttm:agent="v2"><span begin="58.803" end="59.158">I'm</span> <span begin="59.158" end="59.429">not</span> <span begin="59.429" end="59.879">the</span> <span begin="59.879" end="1:00.433">man</span> <span begin="1:00.433" end="1:00.718">they</span> <span begin="1:00.718" end="1:01.026">think</span> <span begin="1:01.026" end="1:01.264">I</span> <span begin="1:01.264" end="1:01.566">am</span> <span begin="1:01.566" end="1:01.905">at</span> <span begin="1:01.990" end="1:02.531">home</span></p><p begin="1:02.531" end="1:05.023" itunes:key="L15" ttm:agent="v2"><span begin="1:02.531" end="1:02.969">Oh,</span> <span begin="1:03.074" end="1:03.605">no,</span> <span begin="1:03.605" end="1:04.072">no,</span> <span begin="1:04.072" end="1:05.023">no</span></p><p begin="1:05.805" end="1:11.377" itunes:key="L16" ttm:agent="v3"><span begin="1:05.805" end="1:06.191">And</span> <span begin="1:06.191" end="1:06.687">this</span> <span begin="1:06.687" end="1:07.182">is</span> <span begin="1:07.182" end="1:07.790">what</span> <span begin="1:07.790" end="1:08.179">I</span> <span begin="1:08.179" end="1:09.256">should</span> <span begin="1:09.256" end="1:10.145">have</span> <span begin="1:10.145" end="1:11.377">said</span></p><p begin="1:13.806" end="1:19.521" itunes:key="L17" ttm:agent="v3"><span begin="1:13.806" end="1:14.216">Well,</span> <span begin="1:14.216" end="1:14.446">I</span> <span begin="1:14.446" end="1:14.997">thought</span> <span begin="1:14.997" end="1:15.480">it,</span> <span begin="1:15.480" end="1:16.080">but</span> <span begin="1:16.080" end="1:16.487">I</span> <span begin="1:16.487" end="1:17.246">kept</span> <span begin="1:17.246" end="1:18.294">it</span> <span begin="1:18.294" end="1:19.521">hid</span></p></div><div begin="1:21.579" end="1:39.223" itunes:songPart="Verse"><p begin="1:21.579" end="1:23.926" itunes:key="L18" ttm:agent="v1"><span begin="1:21.579" end="1:22.142">Cold,</span> <span begin="1:22.142" end="1:22.729">cold</span> <span begin="1:22.729" end="1:23.926">heart</span></p><p begin="1:25.375" end="1:29.323" itunes:key="L19" ttm:agent="v1"><span begin="1:25.375" end="1:25.983">Hardened</span> <span begin="1:25.983" end="1:26.572">by</span> <span begin="1:26.572" end="1:28.369">you</span> <span ttm:role="x-bg"><span begin="1:28.576" end="1:29.323">(Oh)</span></span></p><p begin="1:29.478" end="1:33.424" itunes:key="L20" ttm:agent="v1"><span begin="1:29.478" end="1:29.879">Some</span> <span begin="1:29.879" end="1:30.434">things</span> <span begin="1:30.434" end="1:30.859">look</span> <span begin="1:30.859" end="1:31.847">better,</span> <span begin="1:31.961" end="1:32.465">ba</span><span begin="1:32.465" end="1:33.424">by</span></p><p begin="1:33.724" end="1:39.223" itunes:key="L21" ttm:agent="v1"><span begin="1:33.724" end="1:34.131">Just</span> <span begin="1:34.131" end="1:34.592">pas</span><span begin="1:34.592" end="1:35.053">sing</span> <span begin="1:35.053" end="1:36.877">through</span> <span ttm:role="x-bg"><span begin="1:37.098" end="1:37.467">(No-</span><span begin="1:37.467" end="1:37.734">no-</span><span begin="1:37.734" end="1:38.107">no,</span> <span begin="1:38.233" end="1:38.518">no-</span><span begin="1:38.518" end="1:39.223">no)</span></span></p></div><div begin="1:39.925" end="2:09.222" itunes:songPart="Chorus" ttm:agent="v2"><p begin="1:39.925" end="1:44.133" itunes:key="L22" ttm:agent="v2"><span begin="1:39.925" end="1:40.336">And</span> <span begin="1:40.336" end="1:40.559">I</span> <span begin="1:40.559" end="1:40.851">think</span> <span begin="1:40.851" end="1:41.061">it's</span> <span begin="1:41.061" end="1:41.498">gonna</span> <span begin="1:41.498" end="1:41.939">be</span> <span begin="1:41.939" end="1:42.294">a</span> <span begin="1:42.294" end="1:42.678">long,</span> <span begin="1:42.678" end="1:43.062">long</span> <span begin="1:43.062" end="1:44.133">time</span></p><p begin="1:44.133" end="1:48.321" itunes:key="L23" ttm:agent="v2"><span begin="1:44.133" end="1:44.460">Till</span> <span begin="1:44.460" end="1:44.967">touch</span><span begin="1:44.967" end="1:45.474">down</span> <span begin="1:45.474" end="1:45.950">brings</span> <span begin="1:45.950" end="1:46.227">me</span> <span begin="1:46.227" end="1:46.533">'round</span> <span begin="1:46.533" end="1:46.771">a</span><span begin="1:46.771" end="1:47.077">gain</span> <span begin="1:47.077" end="1:47.496">to</span> <span begin="1:47.496" end="1:48.321">find</span></p><p begin="1:48.477" end="1:52.104" itunes:key="L24" ttm:agent="v2"><span begin="1:48.477" end="1:48.810">I'm</span> <span begin="1:48.810" end="1:49.111">not</span> <span begin="1:49.111" end="1:49.576">the</span> <span begin="1:49.576" end="1:50.106">man</span> <span begin="1:50.106" end="1:50.337">they</span> <span begin="1:50.337" end="1:50.623">think</span> <span begin="1:50.623" end="1:50.934">I</span> <span begin="1:50.934" end="1:51.253">am</span> <span begin="1:51.253" end="1:51.562">at</span> <span begin="1:51.642" end="1:52.104">home</span></p><p begin="1:52.104" end="1:55.725" itunes:key="L25" ttm:agent="v2"><span begin="1:52.104" end="1:52.609">Oh,</span> <span begin="1:52.696" end="1:53.230">no,</span> <span begin="1:53.230" end="1:53.730">no,</span> <span begin="1:53.730" end="1:54.620">no</span> <span ttm:role="x-bg"><span begin="1:53.720" end="1:54.030">(No-</span><span begin="1:54.030" end="1:54.254">no-</span><span begin="1:54.254" end="1:54.657">no,</span> <span begin="1:54.795" end="1:55.097">no-</span><span begin="1:55.097" end="1:55.725">no)</span></span></p><p begin="1:55.452" end="2:00.972" itunes:key="L26" ttm:agent="v3"><span begin="1:55.452" end="1:55.833">And</span> <span begin="1:55.833" end="1:56.348">this</span> <span begin="1:56.348" end="1:56.864">is</span> <span begin="1:56.864" end="1:57.420">what</span> <span begin="1:57.420" end="1:57.866">I</span> <span begin="1:57.866" end="1:58.899">should</span> <span begin="1:58.899" end="1:59.831">have</span> <span begin="1:59.831" end="2:00.972">said</span></p><p begin="2:03.471" end="2:09.222" itunes:key="L27" ttm:agent="v3"><span begin="2:03.471" end="2:03.851">Well,</span> <span begin="2:03.851" end="2:04.056">I</span> <span begin="2:04.056" end="2:04.710">thought</span> <span begin="2:04.710" end="2:05.091">it,</span> <span begin="2:05.091" end="2:05.720">but</span> <span begin="2:05.720" end="2:06.143">I</span> <span begin="2:06.143" end="2:07.188">kept</span> <span begin="2:07.188" end="2:08.210">it</span> <span begin="2:08.210" end="2:09.222">hid</span></p></div><div begin="2:11.242" end="2:28.927" itunes:songPart="Verse"><p begin="2:11.242" end="2:14.922" itunes:key="L28" ttm:agent="v1"><span begin="2:11.242" end="2:11.565">Cold,</span> <span begin="2:11.565" end="2:12.093">cold</span> <span begin="2:12.093" end="2:13.725">heart</span> <span ttm:role="x-bg"><span begin="2:14.103" end="2:14.922">(Oh)</span></span></p><p begin="2:15.020" end="2:18.008" itunes:key="L29" ttm:agent="v1"><span begin="2:15.020" end="2:15.875">Hardened</span> <span begin="2:15.875" end="2:16.423">by</span> <span begin="2:16.423" end="2:18.008">you</span></p><p begin="2:19.103" end="2:23.173" itunes:key="L30" ttm:agent="v1"><span begin="2:19.103" end="2:19.516">Some</span> <span begin="2:19.516" end="2:19.916">things</span> <span begin="2:19.916" end="2:20.388">look</span> <span begin="2:20.388" end="2:21.372">better,</span> <span begin="2:21.490" end="2:22.063">ba</span><span begin="2:22.063" end="2:22.973">by</span> <span ttm:role="x-bg"><span begin="2:22.394" end="2:23.173">(Oh)</span></span></p><p begin="2:23.393" end="2:28.927" itunes:key="L31" ttm:agent="v1"><span begin="2:23.393" end="2:23.755">Just</span> <span begin="2:23.755" end="2:24.235">pas</span><span begin="2:24.235" end="2:24.736">sing</span> <span begin="2:24.736" end="2:26.723">through</span> <span ttm:role="x-bg"><span begin="2:26.772" end="2:27.141">(No-</span><span begin="2:27.141" end="2:27.353">no-</span><span begin="2:27.353" end="2:27.788">no,</span> <span begin="2:27.900" end="2:28.202">no-</span><span begin="2:28.202" end="2:28.927">no)</span></span></p></div><div begin="2:29.605" end="3:01.921" itunes:songPart="Chorus" ttm:agent="v2"><p begin="2:29.605" end="2:33.793" itunes:key="L32" ttm:agent="v2"><span begin="2:29.605" end="2:29.989">And</span> <span begin="2:29.989" end="2:30.178">I</span> <span begin="2:30.178" end="2:30.496">think</span> <span begin="2:30.496" end="2:30.739">it's</span> <span begin="2:30.739" end="2:31.273">gonna</span> <span begin="2:31.273" end="2:31.755">be</span> <span begin="2:31.755" end="2:32.056">a</span> <span begin="2:32.056" end="2:32.541">long,</span> <span begin="2:32.541" end="2:33.072">long</span> <span begin="2:33.072" end="2:33.793">time</span></p><p begin="2:33.793" end="2:38.023" itunes:key="L33" ttm:agent="v2"><span begin="2:33.793" end="2:34.083">Till</span> <span begin="2:34.083" end="2:34.668">touch</span><span begin="2:34.668" end="2:35.127">down</span> <span begin="2:35.127" end="2:35.670">brings</span> <span begin="2:35.670" end="2:35.875">me</span> <span begin="2:35.875" end="2:36.169">'round</span> <span begin="2:36.169" end="2:36.385">a</span><span begin="2:36.385" end="2:36.718">gain</span> <span begin="2:36.718" end="2:37.169">to</span> <span begin="2:37.169" end="2:38.023">find</span></p><p begin="2:38.146" end="2:41.777" itunes:key="L34" ttm:agent="v2"><span begin="2:38.146" end="2:38.503">I'm</span> <span begin="2:38.503" end="2:38.785">not</span> <span begin="2:38.785" end="2:39.179">the</span> <span begin="2:39.179" end="2:39.663">man</span> <span begin="2:39.663" end="2:39.938">they</span> <span begin="2:39.938" end="2:40.242">think</span> <span begin="2:40.242" end="2:40.481">I</span> <span begin="2:40.481" end="2:40.785">am</span> <span begin="2:40.785" end="2:41.228">at</span> <span begin="2:41.228" end="2:41.777">home</span></p><p begin="2:41.777" end="2:45.373" itunes:key="L35" ttm:agent="v2"><span begin="2:41.777" end="2:42.307">Oh,</span> <span begin="2:42.372" end="2:42.876">no,</span> <span begin="2:42.876" end="2:43.374">no,</span> <span begin="2:43.374" end="2:44.371">no</span> <span ttm:role="x-bg"><span begin="2:43.373" end="2:43.679">(No-</span><span begin="2:43.679" end="2:43.927">no-</span><span begin="2:43.927" end="2:44.329">no,</span> <span begin="2:44.445" end="2:44.762">no-</span><span begin="2:44.762" end="2:45.373">no)</span></span></p><p begin="2:45.105" end="2:50.577" itunes:key="L36" ttm:agent="v2"><span begin="2:45.105" end="2:45.493">And</span> <span begin="2:45.493" end="2:46.009">this</span> <span begin="2:46.009" end="2:46.543">is</span> <span begin="2:46.543" end="2:46.996">what</span> <span begin="2:46.996" end="2:47.366">I</span> <span begin="2:47.366" end="2:48.362">should</span> <span begin="2:48.362" end="2:49.285">have</span> <span begin="2:49.285" end="2:50.577">said</span></p><p begin="2:46.154" end="2:50.304" itunes:key="L37" ttm:agent="v2"><span begin="2:46.154" end="2:46.536">And</span> <span begin="2:46.536" end="2:46.768">I</span> <span begin="2:46.768" end="2:47.042">think</span> <span begin="2:47.042" end="2:47.337">it's</span> <span begin="2:47.337" end="2:47.794">gonna</span> <span begin="2:47.794" end="2:48.336">be</span> <span begin="2:48.336" end="2:48.603">a</span> <span begin="2:48.603" end="2:49.102">long,</span> <span begin="2:49.102" end="2:49.474">long</span> <span begin="2:49.474" end="2:50.304">time</span></p><p begin="2:50.304" end="2:54.520" itunes:key="L38" ttm:agent="v2"><span begin="2:50.304" end="2:50.660">Till</span> <span begin="2:50.660" end="2:51.159">touch</span><span begin="2:51.159" end="2:51.711">down</span> <span begin="2:51.711" end="2:52.160">brings</span> <span begin="2:52.160" end="2:52.416">me</span> <span begin="2:52.416" end="2:52.710">'round</span> <span begin="2:52.710" end="2:52.939">a</span><span begin="2:52.939" end="2:53.226">gain</span> <span begin="2:53.226" end="2:53.587">to</span> <span begin="2:53.587" end="2:54.520">find</span></p><p begin="2:53.124" end="2:58.874" itunes:key="L39" ttm:agent="v2"><span begin="2:53.124" end="2:53.517">Well,</span> <span begin="2:53.517" end="2:53.738">I</span> <span begin="2:53.738" end="2:54.290">thought</span> <span begin="2:54.290" end="2:54.774">it,</span> <span begin="2:54.774" end="2:55.329">but</span> <span begin="2:55.329" end="2:55.755">I</span> <span begin="2:55.755" end="2:56.838">kept</span> <span begin="2:56.838" end="2:57.874">it</span> <span begin="2:57.874" end="2:58.874">hid</span></p><p begin="2:54.679" end="2:58.495" itunes:key="L40" ttm:agent="v2"><span begin="2:54.679" end="2:55.038">I'm</span> <span begin="2:55.038" end="2:55.305">not</span> <span begin="2:55.305" end="2:55.821">the</span> <span begin="2:55.821" end="2:56.324">man</span> <span begin="2:56.324" end="2:56.605">they</span> <span begin="2:56.605" end="2:56.858">think</span> <span begin="2:56.858" end="2:57.122">I</span> <span begin="2:57.122" end="2:57.406">am</span> <span begin="2:57.406" end="2:57.856">at</span> <span begin="2:57.856" end="2:58.495">home</span></p><p begin="2:58.304" end="3:01.921" itunes:key="L41" ttm:agent="v2"><span begin="2:58.304" end="2:58.780">Oh,</span> <span begin="2:58.889" end="2:59.472">no,</span> <span begin="2:59.472" end="2:59.966">no,</span> <span begin="2:59.966" end="3:00.824">no</span> <span ttm:role="x-bg"><span begin="2:59.921" end="3:00.234">(No-</span><span begin="3:00.234" end="3:00.512">no-</span><span begin="3:00.512" end="3:00.861">no,</span> <span begin="3:00.980" end="3:01.261">no-</span><span begin="3:01.261" end="3:01.921">no)</span></span></p></div><div begin="3:01.580" end="3:18.624" itunes:songPart="Outro" ttm:agent="v2000"><p begin="3:01.580" end="3:05.672" itunes:key="L42" ttm:agent="v2000"><span begin="3:01.580" end="3:02.180">Shoo</span><span begin="3:02.180" end="3:05.672">rah</span> <span ttm:role="x-bg"><span begin="3:03.773" end="3:04.520">(Oh)</span></span></p><p begin="3:05.674" end="3:09.874" itunes:key="L43" ttm:agent="v2000"><span begin="3:05.674" end="3:06.271">Shoo</span><span begin="3:06.271" end="3:09.874">rah</span></p><p begin="3:09.874" end="3:13.974" itunes:key="L44" ttm:agent="v2000"><span begin="3:09.874" end="3:10.421">Shoo</span><span begin="3:10.421" end="3:13.974">rah</span> <span ttm:role="x-bg"><span begin="3:12.023" end="3:12.828">(Oh)</span></span></p><p begin="3:13.975" end="3:18.624" itunes:key="L45" ttm:agent="v2000"><span begin="3:13.975" end="3:14.519">Shoo</span><span begin="3:14.519" end="3:17.775">rah</span> <span ttm:role="x-bg"><span begin="3:16.409" end="3:16.765">(No-</span><span begin="3:16.765" end="3:17.013">no-</span><span begin="3:17.013" end="3:17.329">no,</span> <span begin="3:17.530" end="3:17.812">no-</span><span begin="3:17.812" end="3:18.624">no)</span></span></p></div></body></tt>`

			const result = extractPlainText(ttml, "ttml")

			// Should extract songwriters from iTunesMetadata
			expect(result).toContain("ANDREW MEECHAM")
			expect(result).toContain("Bernie Taupin")
			expect(result).toContain("Elton John")
			expect(result).toContain("Sam Littlemore")

			// Should extract all lyric text including word-synced spans
			expect(result).toContain("human sign")
			expect(result).toContain("things go wrong")
			expect(result).toContain("Cold, cold heart")
			expect(result).toContain("Hardened by you")
			expect(result).toContain("gonna be a long, long time")
			expect(result).toContain("touchdown brings me")
			expect(result).toContain("Shoorah")

			// Should extract background lyrics
			expect(result).toContain("(Oh)")
			expect(result).toContain("(No-no-no, no-no)")

			// Should NOT contain timing values, songPart labels, or agent identifiers
			expect(result).not.toContain("1.683")
			expect(result).not.toContain("15.104")
			expect(result).not.toContain("Intro")
			expect(result).not.toContain("Verse")
			expect(result).not.toContain("Chorus")
			expect(result).not.toContain("Outro")
			expect(result).not.toContain("v2000")
			expect(result).not.toContain("person")
			expect(result).not.toContain("leadingSilence")
		})

		it("handles empty TTML body", () => {
			const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" lang="en">
  <body></body>
</tt>`

			const result = extractPlainText(ttml, "ttml")
			expect(result).toBe("")
		})
	})
})
