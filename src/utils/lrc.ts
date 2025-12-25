interface LrcLine {
	timeMs: number
	text: string
}

export function parseLrc(lrc: string): LrcLine[] {
	const lines: LrcLine[] = []
	const lineRegex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)$/

	for (const line of lrc.split("\n")) {
		const match = line.match(lineRegex)
		if (!match) continue

		const minutes = Number.parseInt(match[1], 10)
		const seconds = Number.parseInt(match[2], 10)
		let ms = 0
		if (match[3]) {
			ms =
				match[3].length === 2 ? Number.parseInt(match[3], 10) * 10 : Number.parseInt(match[3], 10)
		}

		const timeMs = (minutes * 60 + seconds) * 1000 + ms
		const text = match[4].trim()

		if (text) {
			lines.push({ timeMs, text })
		}
	}

	return lines.sort((a, b) => a.timeMs - b.timeMs)
}

export function lrcToTtml(lrc: string, lang = "en"): string {
	const lines = parseLrc(lrc)
	if (lines.length === 0) return ""

	const lastLine = lines[lines.length - 1]
	const estimatedDuration = lastLine.timeMs + 5000

	const formatTime = (ms: number): string => {
		const totalSeconds = Math.floor(ms / 1000)
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		const milliseconds = ms % 1000
		return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
	}

	let divContent = ""
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const nextLine = lines[i + 1]
		const endTime = nextLine ? nextLine.timeMs : line.timeMs + 5000

		const escapedText = line.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

		divContent += `    <p begin="${formatTime(line.timeMs)}" end="${formatTime(endTime)}">${escapedText}</p>\n`
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" timing="Line" lang="${lang}" dur="${formatTime(estimatedDuration)}">
  <body dur="${formatTime(estimatedDuration)}">
    <div begin="00:00.000" end="${formatTime(estimatedDuration)}" songPart="">
${divContent}    </div>
  </body>
</tt>`
}

export function isLrcFormat(content: string): boolean {
	return /\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(content)
}

export function detectLyricsFormat(content: string): "ttml" | "lrc" | "plain" {
	const trimmed = content.trim()
	if (trimmed.startsWith("<") && /<tt[\s>]/i.test(trimmed)) {
		return "ttml"
	}
	if (isLrcFormat(trimmed)) {
		return "lrc"
	}
	return "plain"
}
