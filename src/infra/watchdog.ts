import { Worker } from "node:worker_threads"
import { Logger } from "./logger"

const log = new Logger("watchdog")

const DEFAULT_FREEZE_MS = 30_000
const RESPAWN_GRACE_MS = 10_000
const MAX_FAST_RESPAWNS = 3

// A frozen event loop cannot run its own timers, so liveness has to be judged
// from another thread. This is the decision the watchdog worker makes each tick.
// A non-positive threshold disables it; a non-finite gap (never heartbeated yet)
// is treated as alive so startup grace isn't a false positive.
export function shouldKill(msSinceHeartbeat: number, freezeMs: number): boolean {
	if (!(freezeMs > 0)) return false
	if (!Number.isFinite(msSinceHeartbeat)) return false
	return msSinceHeartbeat > freezeMs
}

// Decide whether to respawn a worker that just exited. A worker that dies inside
// the grace window counts as a fast failure; after too many in a row we stop so a
// broken worker can't respawn forever. A worker that ran past the window resets
// the streak.
export function respawnDecision(
	msAlive: number,
	fastFailures: number
): { respawn: boolean; fastFailures: number } {
	const next = msAlive < RESPAWN_GRACE_MS ? fastFailures + 1 : 0
	return { respawn: next < MAX_FAST_RESPAWNS, fastFailures: next }
}

// The worker runs on its own thread, unaffected by a blocked main loop. When the
// main thread stops heartbeating past the threshold it SIGKILLs the whole
// process (SIGKILL hits the shared PID, taking down every thread) so Railway's
// restart policy brings it back. shouldKill is inlined via toString so the exact
// tested logic runs here.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads")
${shouldKill.toString()}
const freezeMs = workerData.freezeMs
let last = Date.now()
parentPort.on("message", () => { last = Date.now() })
setInterval(() => {
	if (shouldKill(Date.now() - last, freezeMs)) {
		process.stderr.write("[watchdog] event loop frozen for >" + freezeMs + "ms, killing process for restart\\n")
		process.kill(process.pid, "SIGKILL")
	}
}, Math.max(1000, Math.floor(freezeMs / 5))).unref()
`

export function startWatchdog(): void {
	const freezeMs = Number(process.env.WATCHDOG_FREEZE_MS ?? DEFAULT_FREEZE_MS)
	if (!(freezeMs > 0)) {
		log.info("watchdog disabled", { freezeMs })
		return
	}

	const beatMs = Math.max(1000, Math.floor(freezeMs / 10))
	let fastFailures = 0

	const spawn = (): void => {
		const spawnedAt = Date.now()
		let worker: Worker
		try {
			worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { freezeMs } })
		} catch (err) {
			// Never let a watchdog failure crash boot: run unprotected instead.
			log.error("watchdog failed to start", { error: (err as Error).message })
			return
		}
		worker.unref()

		const beat = setInterval(() => worker.postMessage(0), beatMs)
		beat.unref()

		worker.on("error", (err) => log.error("watchdog worker error", { error: err.message }))
		worker.on("exit", (code) => {
			clearInterval(beat)
			const decision = respawnDecision(Date.now() - spawnedAt, fastFailures)
			fastFailures = decision.fastFailures
			if (!decision.respawn) {
				log.error("watchdog worker keeps dying, protection disabled", { code })
				return
			}
			log.warn("watchdog worker exited, respawning", { code })
			spawn()
		})
	}

	spawn()
	log.info("watchdog started", { freezeMs })
}
