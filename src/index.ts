import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Elysia } from "elysia"
import { node } from "@elysiajs/node"
import { cors } from "@elysiajs/cors"
import { cron } from "@elysiajs/cron"
import { staticPlugin } from "@elysiajs/static"
import { config } from "@/config"
import { createEnv } from "@/infra/env"
import { closePool } from "@/infra/database"
import { closeRedis } from "@/infra/cache"
import { Logger, flushLogs } from "@/infra/logger"
import { backfillSyncType } from "@/jobs/backfill-synctype"
import { backfillTextSearch } from "@/jobs/backfill-text-search"
import { updateScores } from "@/jobs/score-updater"
import { authRoutes } from "@/routes/auth"
import { lyricsRoutes } from "@/routes/lyrics"
import { feedRoutes } from "@/routes/feed"
import { voteRoutes } from "@/routes/votes"
import { requestRoutes } from "@/routes/requests"
import { leaderboardRoutes } from "@/routes/leaderboard"
import { compatRoutes } from "@/routes/compat"

const env = createEnv()
const log = new Logger("app")
const httpLog = new Logger("http")
const cronLog = new Logger("cron")

const SPA_INDEX_PATH = resolve(process.cwd(), "web/dist/index.html")
const API_PREFIXES = [
	"/lyrics",
	"/feed",
	"/votes",
	"/requests",
	"/leaderboard",
	"/auth",
	"/health",
	"/getLyrics",
]

let spaIndexHtml: string | null = null
function loadSpaIndex(): string | null {
	if (spaIndexHtml !== null) return spaIndexHtml
	try {
		spaIndexHtml = readFileSync(SPA_INDEX_PATH, "utf8")
	} catch {
		spaIndexHtml = ""
	}
	return spaIndexHtml || null
}

function isSpaRoute(method: string, pathname: string): boolean {
	if (method !== "GET") return false
	if (pathname.includes(".")) return false
	for (const prefix of API_PREFIXES) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return false
	}
	return true
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
			if (isSpaRoute(method as string, url as string)) {
				const html = loadSpaIndex()
				if (html) {
					set.status = 200
					set.headers["content-type"] = "text/html; charset=utf-8"
					httpLog.info(`${method} ${url} 200 ${duration}ms (spa)`, {
						method: method as string,
						path: url as string,
						status: 200,
						latency_ms: Number(duration),
					})
					return new Response(html, {
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					})
				}
			}
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
	.use(authRoutes(env))
	.use(
		staticPlugin({
			assets: "web/dist",
			prefix: "/",
			indexHTML: true,
		})
	)
	.listen(Number.parseInt(process.env.PORT || "3000", 10))

const port = process.env.PORT || "3000"
log.info(`listening on port ${port}`)

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
