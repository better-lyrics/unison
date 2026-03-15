import { Axiom } from "@axiomhq/js"

type LogLevel = "debug" | "info" | "warn" | "error"

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
}

const GROUP_COLORS: Record<string, string> = {
	http: ANSI.cyan,
	db: ANSI.magenta,
	cache: ANSI.yellow,
	cron: ANSI.blue,
	auth: ANSI.green,
	app: ANSI.white,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: ANSI.gray,
	info: ANSI.cyan,
	warn: ANSI.yellow,
	error: ANSI.red,
}

function colorize(color: string, text: string): string {
	return `${color}${text}${ANSI.reset}`
}

export class Logger {
	private group: string
	private minLevel: LogLevel

	constructor(group: string, minLevel?: LogLevel) {
		this.group = group
		this.minLevel = minLevel ?? ((process.env.LOG_LEVEL as LogLevel) || "info")
	}

	child(group: string): Logger {
		return new Logger(group, this.minLevel)
	}

	debug(message: string, data?: Record<string, unknown>) {
		this.log("debug", message, data)
	}

	info(message: string, data?: Record<string, unknown>) {
		this.log("info", message, data)
	}

	warn(message: string, data?: Record<string, unknown>) {
		this.log("warn", message, data)
	}

	error(message: string, data?: Record<string, unknown>) {
		this.log("error", message, data)
	}

	private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
		if (LEVELS[level] < LEVELS[this.minLevel]) return

		const groupColor = GROUP_COLORS[this.group] ?? ANSI.white
		const levelColor = LEVEL_COLORS[level]
		const prefix = colorize(groupColor, `[${this.group}]`)
		const levelTag = colorize(levelColor, level.toUpperCase().padEnd(5))

		const parts = [levelTag, prefix, message]

		if (data && Object.keys(data).length > 0) {
			const formatted = Object.entries(data)
				.map(
					([k, v]) => `${colorize(ANSI.dim, k)}=${typeof v === "object" ? JSON.stringify(v) : v}`
				)
				.join(" ")
			parts.push(colorize(ANSI.dim, "|"), formatted)
		}

		const output = parts.join(" ")

		if (level === "error") {
			console.error(output)
		} else if (level === "warn") {
			console.warn(output)
		} else {
			console.log(output)
		}

		if (axiom) {
			axiom.ingest(axiomDataset!, [{ level, message, group: this.group, ...data }])
		}
	}
}

export const log = new Logger("app")

const axiomDataset = process.env.AXIOM_DATASET
const axiom =
	process.env.AXIOM_TOKEN && axiomDataset ? new Axiom({ token: process.env.AXIOM_TOKEN }) : null

export async function flushLogs(): Promise<void> {
	if (axiom) await axiom.flush()
}
