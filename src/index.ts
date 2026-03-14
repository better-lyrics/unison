import { Elysia } from "elysia"
import { node } from "@elysiajs/node"
import { cors } from "@elysiajs/cors"
import { cron } from "@elysiajs/cron"
import { createEnv } from "@/infra/env"
import { Logger } from "@/infra/logger"
import { updateScores } from "@/jobs/score-updater"
import { lyricsRoutes } from "@/routes/lyrics"
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
			allowedHeaders: ["Content-Type", "X-Device-ID"],
			maxAge: 86400,
		})
	)
	.use(
		cron({
			name: "score-updater",
			pattern: "0 * * * *",
			async run() {
				cronLog.info("starting score update")
				const result = await updateScores(env)
				cronLog.info("score update complete", { updated: result.updated })
			},
		})
	)
	.onBeforeHandle(({ request, store }) => {
		;(store as Record<string, unknown>).__startTime = performance.now()
		;(store as Record<string, unknown>).__method = request.method
		;(store as Record<string, unknown>).__url = new URL(request.url).pathname
	})
	.onAfterHandle(({ store, set }) => {
		const s = store as Record<string, unknown>
		const duration = (performance.now() - (s.__startTime as number)).toFixed(1)
		const status = typeof set.status === "number" ? set.status : 200
		httpLog.info(`${s.__method} ${s.__url} ${status} ${duration}ms`)
	})
	.onError(({ error, store, set }) => {
		const s = store as Record<string, unknown>
		const duration = s.__startTime
			? (performance.now() - (s.__startTime as number)).toFixed(1)
			: "?"
		const status = typeof set.status === "number" ? set.status : 500
		httpLog.error(`${s.__method || "?"} ${s.__url || "?"} ${status} ${duration}ms`, {
			error: "message" in error ? error.message : String(error),
		})
		return { success: false, error: "Internal Server Error" }
	})
	.get("/", () => ({
		name: "Unison",
		version: "1.1.0",
		description: "Crowdsourced lyrics API for Better Lyrics",
		endpoints: {
			getLyrics: "GET /lyrics?v=videoId OR ?song=...&artist=...&album=...&duration=...",
			searchLyrics: "GET /lyrics/search?song=...&artist=...&album=...&duration=...",
			getLyricsById: "GET /lyrics/:id",
			submitLyrics: "POST /lyrics/submit (accepts TTML or LRC)",
			vote: "POST /lyrics/:id/vote",
			removeVote: "DELETE /lyrics/:id/vote",
			report: "POST /lyrics/:id/report",
		},
	}))
	.get("/health", () => ({ status: "ok", timestamp: Date.now() }))
	.use(compatRoutes(env))
	.use(lyricsRoutes(env))
	.use(voteRoutes(env))
	.listen(Number.parseInt(process.env.PORT || "3000", 10))

const port = process.env.PORT || "3000"
log.info(`listening on port ${port}`)
