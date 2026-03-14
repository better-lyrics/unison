import { Elysia } from "elysia"
import { node } from "@elysiajs/node"
import { cors } from "@elysiajs/cors"
import { cron } from "@elysiajs/cron"
import { createEnv } from "@/infra/env"
import { updateScores } from "@/jobs/score-updater"
import { lyricsRoutes } from "@/routes/lyrics"
import { voteRoutes } from "@/routes/votes"
import { compatRoutes } from "@/routes/compat"

const env = createEnv()

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
				const result = await updateScores(env)
				console.log(`Score update: ${result.updated} lyrics updated`)
			},
		})
	)
	.get("/", () => ({
		name: "Unison",
		version: "1.0.0",
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
	.onError(({ error }) => {
		console.error("Unhandled error:", error)
		return { success: false, error: "Internal Server Error" }
	})
	.listen(Number.parseInt(process.env.PORT || "3000", 10))

const port = process.env.PORT || "3000"
console.log(`Unison listening on port ${port}`)
