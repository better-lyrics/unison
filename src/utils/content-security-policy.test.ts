import { describe, expect, it } from "vitest"
import { SPA_CONTENT_SECURITY_POLICY } from "./content-security-policy"

function directives(policy: string): Map<string, string[]> {
	return new Map(
		policy.split(";").map((part) => {
			const [name, ...sources] = part.trim().split(/\s+/)
			return [name, sources]
		})
	)
}

const csp = directives(SPA_CONTENT_SECURITY_POLICY)

describe("SPA_CONTENT_SECURITY_POLICY", () => {
	describe("scripts", () => {
		it("allows only same-origin scripts, the YouTube iframe API and the Cloudflare analytics beacon", () => {
			expect(csp.get("script-src")).toEqual([
				"'self'",
				"https://www.youtube.com",
				"https://static.cloudflareinsights.com",
			])
		})

		it("never allows inline or eval'd scripts", () => {
			const scripts = csp.get("script-src") ?? []
			expect(scripts).not.toContain("'unsafe-inline'")
			expect(scripts).not.toContain("'unsafe-eval'")
		})

		it("blocks plugins", () => {
			expect(csp.get("object-src")).toEqual(["'none'"])
		})
	})

	describe("exfiltration", () => {
		it("limits fetch and XHR to the API origin, the dump manifest host and the analytics endpoint", () => {
			expect(csp.get("connect-src")).toEqual([
				"'self'",
				"https://unison-dumps.boidu.dev",
				"https://cloudflareinsights.com",
			])
		})

		it("limits images to the hosts the app renders", () => {
			expect(csp.get("img-src")).toEqual([
				"'self'",
				"data:",
				"https://cdn.betterlyrics.org",
				"https://i.ytimg.com",
				"https://*.googleusercontent.com",
				"https://cdn.discordapp.com",
				"https://github.com",
				"https://avatars.githubusercontent.com",
			])
		})

		it("keeps forms and the base URL on this origin", () => {
			expect(csp.get("form-action")).toEqual(["'self'"])
			expect(csp.get("base-uri")).toEqual(["'self'"])
		})
	})

	describe("framing", () => {
		it("only frames the YouTube player", () => {
			expect(csp.get("frame-src")).toEqual(["https://www.youtube.com"])
		})

		it("cannot be framed by other sites", () => {
			expect(csp.get("frame-ancestors")).toEqual(["'none'"])
		})
	})

	describe("styles and fonts", () => {
		it("allows the font stylesheets and inline styles", () => {
			expect(csp.get("style-src")).toEqual([
				"'self'",
				"'unsafe-inline'",
				"https://api.fontshare.com",
				"https://fonts.googleapis.com",
			])
		})

		it("allows the font files", () => {
			expect(csp.get("font-src")).toEqual(["'self'", "data:", "https://cdn.fontshare.com", "https://fonts.gstatic.com"])
		})
	})

	describe("regressions", () => {
		it("regression: allows the About page GitHub credit avatars and their redirect target", () => {
			const images = csp.get("img-src") ?? []
			expect(images).toContain("https://github.com")
			expect(images).toContain("https://avatars.githubusercontent.com")
		})

		it("regression: keeps the Cloudflare Web Analytics beacon that the edge injects into the HTML", () => {
			expect(csp.get("script-src")).toContain("https://static.cloudflareinsights.com")
			expect(csp.get("connect-src")).toContain("https://cloudflareinsights.com")
		})
	})

	describe("edge cases", () => {
		it("never allows plain http sources", () => {
			for (const sources of csp.values()) {
				for (const source of sources) expect(source.startsWith("http:")).toBe(false)
			}
		})

		it("does not repeat a directive", () => {
			const names = SPA_CONTENT_SECURITY_POLICY.split(";").map((part) => part.trim().split(/\s+/)[0])
			expect(new Set(names).size).toBe(names.length)
		})
	})

	describe("invariants", () => {
		it("falls back to same-origin for anything not listed", () => {
			expect(csp.get("default-src")).toEqual(["'self'"])
		})

		it("never allows a bare wildcard source", () => {
			for (const sources of csp.values()) expect(sources).not.toContain("*")
		})

		it("is a single header line", () => {
			expect(SPA_CONTENT_SECURITY_POLICY).not.toMatch(/[\r\n]/)
		})
	})
})
