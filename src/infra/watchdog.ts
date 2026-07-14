import { Worker } from "node:worker_threads"
import { Logger } from "./logger"

const log = new Logger("watchdog")

const DEFAULT_FREEZE_MS = 30_000

// A frozen event loop cannot run its own timers, so liveness has to be judged
// from another thread. This is the decision the watchdog worker makes each tick.
// A non-positive threshold disables it; a non-finite gap (never heartbeated yet)
// is treated as alive so startup grace isn't a false positive.
export function shouldKill(msSinceHeartbeat: number, freezeMs: number): boolean {
	if (!(freezeMs > 0)) return false
	if (!Number.isFinite(msSinceHeartbeat)) return false
	return msSinceHeartbeat > freezeMs
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

	const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { freezeMs } })
	worker.unref()
	worker.on("error", (err) => log.error("watchdog worker error", { error: err.message }))

	const beat = setInterval(() => worker.postMessage(0), Math.max(1000, Math.floor(freezeMs / 10)))
	beat.unref()

	log.info("watchdog started", { freezeMs })
}
