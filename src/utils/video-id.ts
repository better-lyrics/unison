const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function isVideoId(value: unknown): value is string {
	return typeof value === "string" && VIDEO_ID.test(value)
}
