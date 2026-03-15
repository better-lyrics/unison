import { Elysia } from "elysia"
import { node } from "@elysiajs/node"
import { cors } from "@elysiajs/cors"
import { cron } from "@elysiajs/cron"
import { createEnv } from "@/infra/env"
import { Logger, flushLogs } from "@/infra/logger"
import { backfillTextSearch } from "@/jobs/backfill-text-search"
import { updateScores } from "@/jobs/score-updater"
import { lyricsRoutes } from "@/routes/lyrics"
import { feedRoutes } from "@/routes/feed"
import { voteRoutes } from "@/routes/votes"
import { compatRoutes } from "@/routes/compat"

const env = createEnv()
const log = new Logger("app")
const httpLog = new Logger("http")
const cronLog = new Logger("cron")

const app = new Elysia({ adapter: node() })
	.use(
		cors({
			origin: true,
			methods: ["GET", "POST", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "X-Device-ID", "X-Key-ID"],
			maxAge: 86400,
		})
	)
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
	.get("/", () => ({
		name: "Unison",
		version: "1.1.0",
		description: "Crowdsourced lyrics API for Better Lyrics",
		endpoints: {
			getLyrics: "GET /lyrics?v=videoId OR ?song=...&artist=...&album=...&duration=...",
			searchLyrics: "GET /lyrics/search?q=query OR ?song=...&artist=...&album=...&duration=...",
			getLyricsVariants: "GET /lyrics/variants/:videoId?limit=...",
			getLyricsById: "GET /lyrics/:id",
			submitLyrics: "POST /lyrics/submit (accepts TTML or LRC)",
			vote: "POST /lyrics/:id/vote",
			removeVote: "DELETE /lyrics/:id/vote",
			report: "POST /lyrics/:id/report",
			feed: "GET /feed?limit=...&cursor=...",
		},
	}))
	.get("/health", () => ({ status: "ok", timestamp: Date.now() }))
	.use(compatRoutes(env))
	.use(lyricsRoutes(env))
	.use(feedRoutes(env))
	.use(voteRoutes(env))
	.listen(Number.parseInt(process.env.PORT || "3000", 10))

const port = process.env.PORT || "3000"
log.info(`listening on port ${port}`)

backfillTextSearch(env)
	.then(({ updated }) => {
		if (updated > 0) log.info("text search backfill complete", { updated })
	})
	.catch((err) => log.error("text search backfill failed", { error: (err as Error).message }))

const shutdown = async () => {
	log.info("shutting down")
	await flushLogs()
	process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
