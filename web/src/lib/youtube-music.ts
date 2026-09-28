export function youTubeMusicUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(["music.youtube.com", "youtube.com", "www.youtube.com", "m.youtube.com"])

export function videoIdFromInput(input: string): string | null {
  const text = input.trim()
  if (VIDEO_ID.test(text)) return text
  let url: URL
  try {
    url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const id =
    url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : YOUTUBE_HOSTS.has(url.hostname) && url.pathname === "/watch"
        ? url.searchParams.get("v")
        : null
  return id && VIDEO_ID.test(id) ? id : null
}
