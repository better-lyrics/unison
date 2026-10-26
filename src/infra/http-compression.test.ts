import { get as httpGet } from "node:http"
import { createServer } from "node:net"
import { gunzipSync } from "node:zlib"
import { config } from "@/config"
import { badgeRoutes } from "@/routes/badges"
import type { Env } from "@/types"
import { cors } from "@elysiajs/cors"
import { node } from "@elysiajs/node"
import { Elysia } from "elysia"
import { describe, expect, it } from "vitest"
import { httpCompression } from "./http-compression"

function makeEnv(): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const cache = {
		async get() {
			return null
		},
		async put() {},
		async delete() {},
		async keys() {
			return []
		},
		async setNX() {
			return true
		},
	}
	return {
		DB: {} as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		CDN: null,
	}
}

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div begin="00:12.300" end="00:20.100"><p begin="00:12.300" end="00:15.800"><span begin="00:12.300" end="00:12.900">I've</span> <span begin="00:12.900" end="00:13.400">been</span> <span begin="00:13.400" end="00:14.100">tryna</span> <span begin="00:14.100" end="00:15.800">call</span></p></div></body></tt>`

const lyricBody = {
	success: true,
	data: {
		id: 4821,
		videoId: "4NRXx6U8ABQ",
		song: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		duration: 200,
		format: "ttml",
		syncType: "richsync",
		lyrics: TTML.repeat(8),
		userVote: null,
	},
}

const base = () => new Elysia().use(httpCompression)

function appWith<T>(handler: (app: ReturnType<typeof base>) => T): T {
	return handler(base())
}

function get(app: { handle: (r: Request) => Promise<Response> }, path: string, encoding?: string) {
	const headers: Record<string, string> = {}
	if (encoding !== undefined) headers["accept-encoding"] = encoding
	return app.handle(new Request(`http://localhost${path}`, { headers }))
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer()
		probe.once("error", reject)
		probe.listen(0, () => {
			const address = probe.address()
			const port = typeof address === "object" && address ? address.port : 0
			probe.close(() => resolve(port))
		})
	})
}

interface RawResponse {
	headers: Record<string, unknown>
	body: Buffer
}

function rawGet(port: number, path: string): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		httpGet({ port, path, headers: { "accept-encoding": "gzip" } }, (r) => {
			const chunks: Buffer[] = []
			r.on("data", (c) => chunks.push(c))
			r.on("end", () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }))
		}).on("error", reject)
	})
}

async function getWhenListening(port: number, path: string): Promise<RawResponse> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await rawGet(port, path)
		} catch (err) {
			const refused = (err as NodeJS.ErrnoException).code === "ECONNREFUSED"
			if (!refused || attempt >= 40) throw err
			await new Promise((r) => setTimeout(r, 25))
		}
	}
}

async function gunzipText(res: Response): Promise<string> {
	return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")
}

describe("httpCompression", () => {
	describe("happy paths", () => {
		it("gzips a large JSON body when the client accepts gzip", async () => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const res = await get(app, "/lyrics", "gzip, deflate, br")

			expect(res.status).toBe(200)
			expect(res.headers.get("content-encoding")).toBe("gzip")
			expect(res.headers.get("content-type")).toContain("application/json")
			expect(JSON.parse(await gunzipText(res))).toEqual(lyricBody)
		})

		it("gzips a real route registered through use()", async () => {
			const app = new Elysia().use(httpCompression).use(badgeRoutes(makeEnv()))
			const res = await get(app, "/badges", "gzip")

			expect(res.headers.get("content-encoding")).toBe("gzip")
			const body = JSON.parse(await gunzipText(res))
			expect(body.success).toBe(true)
			expect(body.data.badges.length).toBeGreaterThan(0)
		})

		it("keeps headers the handler set", async () => {
			const app = appWith((a) =>
				a.get("/lyrics", ({ set }) => {
					set.headers["cache-control"] = "public, max-age=60"
					return lyricBody
				})
			)
			const res = await get(app, "/lyrics", "gzip")

			expect(res.headers.get("cache-control")).toBe("public, max-age=60")
			expect(res.headers.get("content-encoding")).toBe("gzip")
		})

		it("sends a body much smaller than the raw JSON", async () => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const res = await get(app, "/lyrics", "gzip")
			const compressed = (await res.arrayBuffer()).byteLength

			expect(compressed).toBeLessThan(JSON.stringify(lyricBody).length / 3)
		})
	})

	describe("negotiation", () => {
		it.each([
			["missing header", undefined],
			["empty header", ""],
			["brotli only", "br"],
			["identity only", "identity"],
			["gzip refused with q=0", "gzip;q=0, br"],
			["gzip refused with q=0.0", "br, gzip; q=0.0"],
		])("sends plain JSON for %s", async (_label, encoding) => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const res = await get(app, "/lyrics", encoding)

			expect(res.headers.get("content-encoding")).toBeNull()
			expect(await res.json()).toEqual(lyricBody)
		})

		it.each([
			["uppercase", "GZIP"],
			["with q value", "gzip;q=0.8"],
			["among others", "deflate, gzip, br"],
			["wildcard", "*"],
			["spaces", " br ,  gzip "],
		])("gzips for %s", async (_label, encoding) => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const res = await get(app, "/lyrics", encoding)

			expect(res.headers.get("content-encoding")).toBe("gzip")
		})

		it("marks every JSON response as varying on accept-encoding", async () => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const plain = await get(app, "/lyrics")
			const gzipped = await get(app, "/lyrics", "gzip")

			expect(plain.headers.get("vary")?.toLowerCase()).toContain("accept-encoding")
			expect(gzipped.headers.get("vary")?.toLowerCase()).toContain("accept-encoding")
		})
	})

	describe("edge cases", () => {
		it("leaves a body under the size floor uncompressed", async () => {
			const app = appWith((a) => a.get("/health", () => ({ status: "ok", timestamp: 1 })))
			const res = await get(app, "/health", "gzip")

			expect(res.headers.get("content-encoding")).toBeNull()
			expect(await res.json()).toEqual({ status: "ok", timestamp: 1 })
		})

		it("compresses a body exactly at the size floor", async () => {
			const filler = "a".repeat(config.http.compressMinBytes - JSON.stringify({ t: "" }).length)
			const body = { t: filler }
			expect(JSON.stringify(body).length).toBe(config.http.compressMinBytes)

			const app = appWith((a) => a.get("/x", () => body))
			const res = await get(app, "/x", "gzip")

			expect(res.headers.get("content-encoding")).toBe("gzip")
		})

		it("round-trips unicode lyrics byte for byte", async () => {
			const body = { lyrics: "夜に駆ける 🌙 Ñandú ¿qué? ".repeat(200) }
			const app = appWith((a) => a.get("/x", () => body))
			const res = await get(app, "/x", "gzip")

			expect(JSON.parse(await gunzipText(res))).toEqual(body)
		})

		it("gzips a large JSON array", async () => {
			const body = Array.from({ length: 50 }, (_, i) => ({ id: i, song: "Blinding Lights" }))
			const app = appWith((a) => a.get("/x", () => body))
			const res = await get(app, "/x", "gzip")

			expect(JSON.parse(await gunzipText(res))).toEqual(body)
		})

		it("passes a Response through untouched", async () => {
			const svg = `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(1000)}</svg>`
			const app = appWith((a) =>
				a.get("/img.svg", () => new Response(svg, { headers: { "content-type": "image/svg+xml" } }))
			)
			const res = await get(app, "/img.svg", "gzip")

			expect(res.headers.get("content-encoding")).toBeNull()
			expect(await res.text()).toBe(svg)
		})

		it("passes a string body through untouched", async () => {
			const text = "plain ".repeat(1000)
			const app = appWith((a) => a.get("/t", () => text))
			const res = await get(app, "/t", "gzip")

			expect(res.headers.get("content-encoding")).toBeNull()
			expect(await res.text()).toBe(text)
		})
	})

	describe("error paths", () => {
		it("keeps the status code of a large error body", async () => {
			const errorBody = { success: false, error: "Not found", detail: "x".repeat(2000) }
			const app = appWith((a) => a.get("/lyrics", ({ status }) => status(404, errorBody)))
			const res = await get(app, "/lyrics", "gzip")

			expect(res.status).toBe(404)
			expect(res.headers.get("content-encoding")).toBe("gzip")
			expect(JSON.parse(await gunzipText(res))).toEqual(errorBody)
		})

		it("keeps the status code of a small error body", async () => {
			const app = appWith((a) =>
				a.get("/lyrics", ({ status }) => status(400, { success: false, error: "bad" }))
			)
			const res = await get(app, "/lyrics", "gzip")

			expect(res.status).toBe(400)
			expect(await res.json()).toEqual({ success: false, error: "bad" })
		})
	})

	describe("node adapter", () => {
		it("serves a gzip body over a real socket", async () => {
			const port = await freePort()
			let stop: (() => unknown) | undefined
			new Elysia({ adapter: node() })
				.use(httpCompression)
				.get("/lyrics", () => lyricBody)
				.listen(port, (server) => {
					stop = () => server.stop()
				})
			try {
				const res = await getWhenListening(port, "/lyrics")

				expect(res.headers["content-encoding"]).toBe("gzip")
				expect(JSON.parse(gunzipSync(res.body).toString("utf8"))).toEqual(lyricBody)
			} finally {
				await stop?.()
			}
		})
	})

	describe("regressions", () => {
		const corsApp = (withCompression: boolean) => {
			const app = new Elysia().use(cors({ origin: true }))
			return (withCompression ? app.use(httpCompression) : app)
				.get("/lyrics", () => lyricBody)
				.get("/health", () => ({ status: "ok" }))
		}

		function corsGet(app: ReturnType<typeof corsApp>, path: string, encoding?: string) {
			const headers: Record<string, string> = { origin: "https://music.youtube.com" }
			if (encoding) headers["accept-encoding"] = encoding
			return app.handle(new Request(`http://localhost${path}`, { headers }))
		}

		it.each([
			["gzipped body", "/lyrics", "gzip"],
			["body without gzip", "/lyrics", undefined],
			["small body", "/health", "gzip"],
		])("regression: keeps the CORS vary header on a %s", async (_label, path, encoding) => {
			const res = await corsGet(corsApp(true), path, encoding)

			expect(res.headers.get("vary")).toBe("*")
			expect(res.headers.get("access-control-allow-origin")).toBe("https://music.youtube.com")
		})

		it.each([
			["gzipped body", "/lyrics", "gzip"],
			["body without gzip", "/lyrics", undefined],
			["small body", "/health", "gzip"],
		])(
			"regression: changes no header except content-encoding on a %s",
			async (_label, path, encoding) => {
				const before = await corsGet(corsApp(false), path, encoding)
				const after = await corsGet(corsApp(true), path, encoding)
				const headers = (r: Response) =>
					Object.fromEntries([...r.headers].filter(([k]) => k !== "content-encoding"))

				expect(headers(after)).toEqual(headers(before))
			}
		)

		it("adds accept-encoding to a vary value the handler set", async () => {
			const app = appWith((a) =>
				a.get("/lyrics", ({ set }) => {
					set.headers.vary = "Origin"
					return lyricBody
				})
			)
			const res = await get(app, "/lyrics", "gzip")

			expect(res.headers.get("vary")).toBe("Origin, Accept-Encoding")
		})

		it("does not repeat accept-encoding already in vary", async () => {
			const app = appWith((a) =>
				a.get("/lyrics", ({ set }) => {
					set.headers.vary = "accept-encoding"
					return lyricBody
				})
			)
			const res = await get(app, "/lyrics", "gzip")

			expect(res.headers.get("vary")).toBe("accept-encoding")
		})
	})

	describe("invariants", () => {
		it("sends the same content-type with and without gzip", async () => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const plain = await get(app, "/lyrics")
			const gzipped = await get(app, "/lyrics", "gzip")

			expect(gzipped.headers.get("content-type")).toBe(plain.headers.get("content-type"))
		})

		it("does not mutate the handler's return value", async () => {
			const body = structuredClone(lyricBody)
			const app = appWith((a) => a.get("/lyrics", () => body))
			await get(app, "/lyrics", "gzip")

			expect(body).toEqual(lyricBody)
		})

		it("gives the same decoded body with and without gzip", async () => {
			const app = appWith((a) => a.get("/lyrics", () => lyricBody))
			const plain = await (await get(app, "/lyrics")).text()
			const gzipped = await gunzipText(await get(app, "/lyrics", "gzip"))

			expect(gzipped).toBe(plain)
		})
	})
})
