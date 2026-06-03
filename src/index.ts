import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { config } from "@/config"
import { closeRedis } from "@/infra/cache"
import { closePool } from "@/infra/database"
import { createEnv } from "@/infra/env"
import { Logger, flushLogs } from "@/infra/logger"
import { backfillFormatDetection } from "@/jobs/backfill-format-detection"
import { backfillSyncType } from "@/jobs/backfill-synctype"
import { backfillTextSearch } from "@/jobs/backfill-text-search"
import { runDumpJob } from "@/jobs/dump"
import { updateScores } from "@/jobs/score-updater"
import { authRoutes } from "@/routes/auth"
import { compatRoutes } from "@/routes/compat"
import { feedRoutes } from "@/routes/feed"
import { leaderboardRoutes } from "@/routes/leaderboard"
import { lyricsRoutes } from "@/routes/lyrics"
import { requestRoutes } from "@/routes/requests"
import { userRoutes } from "@/routes/users"
import { voteRoutes } from "@/routes/votes"
import { cors } from "@elysiajs/cors"
import { cron } from "@elysiajs/cron"
import { node } from "@elysiajs/node"
import { Elysia, NotFoundError } from "elysia"

const env = createEnv()
const log = new Logger("app")
const httpLog = new Logger("http")
const cronLog = new Logger("cron")

// @elysiajs/static on the Node adapter omits content-type headers and ignores
// indexHTML for unmatched routes, so we serve the SPA dist ourselves.
const SPA_DIST = resolve(process.cwd(), "web/dist")
const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
}

let spaIndexHtml: string | null = null
try {
	spaIndexHtml = readFileSync(resolve(SPA_DIST, "index.html"), "utf8")
} catch {
	spaIndexHtml = null
}

function readSpaFile(pathname: string): { body: Buffer; contentType: string } | null {
	const cleaned = pathname.replace(/^\/+/, "")
	if (!cleaned) return null
	const fullPath = resolve(SPA_DIST, cleaned)
	if (fullPath !== SPA_DIST && !fullPath.startsWith(`${SPA_DIST}${sep}`)) return null
	try {
		if (!statSync(fullPath).isFile()) return null
	} catch {
		return null
	}
	const body = readFileSync(fullPath)
	const contentType = MIME_TYPES[extname(fullPath).toLowerCase()] ?? "application/octet-stream"
	return { body, contentType }
}

const app = new Elysia({ adapter: node() })
	.use(
		cors({
			origin: true,
			methods: ["GET", "POST", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "X-Device-ID", "X-Key-ID"],
			maxAge: 86400,
		})
	)
	.onParse(({ request, set }) => {
		const len = request.headers.get("content-length")
		if (len && Number(len) > config.http.maxBodyBytes) {
			set.status = 413
			return { success: false, error: "Payload too large" }
		}
	})
	.use(
		cron({
			name: "score-updater",
			pattern: "0 */6 * * *",
			async run() {
				cronLog.info("starting score update")
				const result = await updateScores(env)
				cronLog.info("score update complete", { updated: result.updated })
			},
		})
	)
	.use(
		cron({
			name: "dump",
			pattern: "15 15 * * *",
			timezone: "UTC",
			async run() {
				cronLog.info("starting daily dump")
				const result = await runDumpJob(env)
				if (result.status === "failed") {
					cronLog.error("daily dump failed", result)
				} else if (result.status === "skipped") {
					cronLog.warn("daily dump skipped", result)
				} else {
					cronLog.info("daily dump complete", result)
				}
			},
		})
	)
	.onRequest(({ request, store }) => {
		const s = store as Record<string, unknown>
		s.__startTime = performance.now()
		s.__method = request.method
		s.__url = new URL(request.url).pathname
	})
	.onAfterResponse(({ store, set }) => {
		const s = store as Record<string, unknown>
		if (!s.__startTime) return
		const duration = (performance.now() - (s.__startTime as number)).toFixed(1)
		const status = typeof set.status === "number" ? set.status : 200
		if (status >= 400) return // already logged by onError
		httpLog.info(`${s.__method} ${s.__url} ${status} ${duration}ms`, {
			method: s.__method as string,
			path: s.__url as string,
			status,
			latency_ms: Number(duration),
		})
	})
	.onError(({ code, error, request, store, set }) => {
		const s = store as Record<string, unknown>
		const method = s.__method || request.method
		const url = s.__url || new URL(request.url).pathname
		const duration = s.__startTime
			? (performance.now() - (s.__startTime as number)).toFixed(1)
			: "?"

		if (code === "NOT_FOUND") {
			httpLog.warn(`${method} ${url} 404 ${duration}ms`)
			return { success: false, error: "Not Found" }
		}

		const status = typeof set.status === "number" ? set.status : 500
		const message = "message" in error ? error.message : String(error)
		httpLog.error(`${method} ${url} ${status} ${duration}ms`, {
			method: method as string,
			path: url as string,
			status,
			latency_ms: Number(duration),
			error: message,
			stack: "stack" in error ? error.stack : undefined,
		})
		return { success: false, error: "Internal Server Error" }
	})
	.get("/health", () => ({ status: "ok", timestamp: Date.now() }))
	.use(compatRoutes(env))
	.use(lyricsRoutes(env))
	.use(feedRoutes(env))
	.use(voteRoutes(env))
	.use(requestRoutes(env))
	.use(leaderboardRoutes(env))
	.use(userRoutes(env))
	.use(authRoutes(env))
	.get("/*", ({ request }) => {
		const { pathname } = new URL(request.url)

		if (pathname.includes(".")) {
			const file = readSpaFile(pathname)
			if (file) {
				return new Response(file.body, {
					status: 200,
					headers: {
						"content-type": file.contentType,
						"cache-control": "public, max-age=31536000, immutable",
					},
				})
			}
			throw new NotFoundError()
		}

		if (spaIndexHtml) {
			return new Response(spaIndexHtml, {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			})
		}

		throw new NotFoundError()
	})
	.listen(Number.parseInt(process.env.PORT || "3000", 10))

const port = process.env.PORT || "3000"
log.info(`listening on port ${port}`)
log.info("spa serving", {
	cwd: process.cwd(),
	spaDist: SPA_DIST,
	indexHtmlLoaded: spaIndexHtml !== null,
	assetsDirExists: existsSync(resolve(SPA_DIST, "assets")),
})

backfillTextSearch(env)
	.then(({ updated }) => {
		if (updated > 0) log.info("text search backfill complete", { updated })
	})
	.catch((err) => log.error("text search backfill failed", { error: (err as Error).message }))

backfillSyncType(env)
	.then(({ scanned, changed }) => {
		if (changed > 0) log.info("sync_type backfill complete", { scanned, changed })
	})
	.catch((err) => log.error("sync_type backfill failed", { error: (err as Error).message }))

backfillFormatDetection(env)
	.then(({ scanned, changed }) => {
		if (changed > 0) log.info("format backfill complete", { scanned, changed })
	})
	.catch((err) => log.error("format backfill failed", { error: (err as Error).message }))

process.on("unhandledRejection", (reason) => {
	const err = reason instanceof Error ? reason : new Error(String(reason))
	log.error("unhandled rejection", { error: err.message, stack: err.stack })
	flushLogs().finally(() => process.exit(1))
})

process.on("uncaughtException", (err) => {
	log.error("uncaught exception", { error: err.message, stack: err.stack })
	flushLogs().finally(() => process.exit(1))
})

const shutdown = async () => {
	log.info("shutting down")
	await Promise.allSettled([closePool(), closeRedis()])
	await flushLogs()
	process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
