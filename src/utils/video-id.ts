const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set([
	"music.youtube.com",
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
])
const LINK_FRAGMENT = /^(?:\/?watch)?\??(?:v=|=)?([A-Za-z0-9_-]{11})(?:[&?#].*)?$/
const ID_PATH = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/

export const VIDEO_ID_HINT =
	"Use a YouTube video id like dQw4w9WgXcQ, or paste the YouTube or YouTube Music link."

export function isVideoId(value: unknown): value is string {
	return typeof value === "string" && VIDEO_ID.test(value)
}

export function videoIdFromInput(input: string): string | null {
	const text = input.trim()
	if (VIDEO_ID.test(text)) return text
	return idFromLink(text) ?? text.match(LINK_FRAGMENT)?.[1] ?? null
}

function idFromLink(text: string): string | null {
	let url: URL
	try {
		url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`)
	} catch {
		return null
	}
	let id: string | null = null
	if (url.hostname === "youtu.be") id = url.pathname.slice(1).replace(/\/$/, "")
	else if (YOUTUBE_HOSTS.has(url.hostname))
		id =
			url.pathname === "/watch"
				? url.searchParams.get("v")
				: (url.pathname.match(ID_PATH)?.[1] ?? null)
	return id && VIDEO_ID.test(id) ? id : null
}
