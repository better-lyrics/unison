import { updateScores } from "@/jobs/score-updater"
import compat from "@/routes/compat"
import lyrics from "@/routes/lyrics"
import votes from "@/routes/votes"
import type { Env } from "@/types"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

const app = new Hono<{ Bindings: Env }>()

app.use("*", logger())

app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "X-Device-ID"],
		maxAge: 86400,
	})
)

app.get("/", (c) => {
	return c.json({
		name: "Unison",
		version: "1.0.0",
		description: "Crowdsourced lyrics API for Better Lyrics",
		endpoints: {
			getLyrics: "GET /lyrics?v=videoId OR ?song=...&artist=...&duration=...",
			getLyricsById: "GET /lyrics/:id",
			submitLyrics: "POST /lyrics/submit (accepts TTML or LRC)",
			vote: "POST /lyrics/:id/vote",
			removeVote: "DELETE /lyrics/:id/vote",
			report: "POST /lyrics/:id/report",
		},
	})
})

app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: Date.now() })
})

app.route("/", compat)
app.route("/lyrics", lyrics)
app.route("/lyrics", votes)

app.notFound((c) => {
	return c.json({ success: false, error: "Not Found" }, 404)
})

app.onError((err, c) => {
	console.error("Unhandled error:", err)
	return c.json({ success: false, error: "Internal Server Error" }, 500)
})

export default {
	fetch: app.fetch,
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(
			updateScores(env).then((result) => {
				console.log(`Score update completed: ${result.updated} lyrics updated`)
			})
		)
	},
}
