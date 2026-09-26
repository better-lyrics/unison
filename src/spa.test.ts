import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SPA_CONTENT_SECURITY_POLICY } from "@/utils/content-security-policy"
import { loadSpa, type Spa, serveSpa } from "./spa"

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>'

let dist: string
let spa: Spa

beforeAll(() => {
	dist = mkdtempSync(join(tmpdir(), "spa-dist-"))
	mkdirSync(join(dist, "assets"))
	writeFileSync(join(dist, "index.html"), INDEX_HTML)
	writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)")
	writeFileSync(join(dist, "logo.svg"), "<svg/>")
	spa = loadSpa(dist)
})

afterAll(() => rmSync(dist, { recursive: true, force: true }))

describe("serveSpa", () => {
	describe("html documents", () => {
		it("serves the index with the content security policy for app routes", async () => {
			const res = serveSpa("/song/xS_E7WzPjvE", spa)
			expect(res?.status).toBe(200)
			expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8")
			expect(res?.headers.get("content-security-policy")).toBe(SPA_CONTENT_SECURITY_POLICY)
			expect(await res?.text()).toBe(INDEX_HTML)
		})

		it("serves the root path the same way", () => {
			expect(serveSpa("/", spa)?.headers.get("content-security-policy")).toBe(SPA_CONTENT_SECURITY_POLICY)
		})
	})

	describe("static assets", () => {
		it("serves hashed assets with an immutable cache and their content type", async () => {
			const res = serveSpa("/assets/index-abc.js", spa)
			expect(res?.headers.get("content-type")).toBe("application/javascript; charset=utf-8")
			expect(res?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
			expect(await res?.text()).toBe("console.log(1)")
		})

		it("does not attach the policy to non-document files", () => {
			expect(serveSpa("/logo.svg", spa)?.headers.get("content-security-policy")).toBeNull()
		})
	})

	describe("regressions", () => {
		it("regression: /index.html gets the policy instead of bypassing it as a static file", () => {
			const res = serveSpa("/index.html", spa)
			expect(res?.headers.get("content-security-policy")).toBe(SPA_CONTENT_SECURITY_POLICY)
			expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8")
		})

		it("regression: /index.html is never cached as immutable", () => {
			expect(serveSpa("/index.html", spa)?.headers.get("cache-control")).toBeNull()
		})
	})

	describe("edge cases", () => {
		it("returns null for a missing file so the caller can 404", () => {
			expect(serveSpa("/assets/missing.js", spa)).toBeNull()
		})

		it("refuses to read outside the dist directory", () => {
			expect(serveSpa("/../package.json", spa)).toBeNull()
			expect(serveSpa("/assets/../../etc/passwd", spa)).toBeNull()
		})

		it("returns null for app routes when no build is present", () => {
			const empty = mkdtempSync(join(tmpdir(), "spa-empty-"))
			try {
				const bare = loadSpa(empty)
				expect(bare.indexHtml).toBeNull()
				expect(serveSpa("/", bare)).toBeNull()
				expect(serveSpa("/index.html", bare)).toBeNull()
			} finally {
				rmSync(empty, { recursive: true, force: true })
			}
		})

		it("treats an upper-case extension as the same file type", () => {
			writeFileSync(join(dist, "INDEX.HTML"), INDEX_HTML)
			expect(serveSpa("/INDEX.HTML", spa)?.headers.get("content-security-policy")).toBe(SPA_CONTENT_SECURITY_POLICY)
		})
	})

	describe("invariants", () => {
		it("every html response carries the policy and no immutable cache", () => {
			for (const path of ["/", "/me", "/index.html", "/u/aurora"]) {
				const res = serveSpa(path, spa)
				expect(res?.headers.get("content-security-policy")).toBe(SPA_CONTENT_SECURITY_POLICY)
				expect(res?.headers.get("cache-control") ?? "").not.toContain("immutable")
			}
		})
	})
})
