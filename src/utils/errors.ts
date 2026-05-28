export const ErrorCode = {
	INVALID_PAYLOAD: "INVALID_PAYLOAD",
	SONG_TOO_LONG: "SONG_TOO_LONG",
	ARTIST_TOO_LONG: "ARTIST_TOO_LONG",
	PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
	INVALID_DURATION: "INVALID_DURATION",
	TTML_MALFORMED: "TTML_MALFORMED",
	TTML_FORMATTED: "TTML_FORMATTED",
	RATE_LIMITED: "RATE_LIMITED",
	VARIANT_CAP_REACHED: "VARIANT_CAP_REACHED",
	AUTH_REQUIRED: "AUTH_REQUIRED",
	INVALID_ID: "INVALID_ID",
	NOT_OWNER: "NOT_OWNER",
	NOT_FOUND: "NOT_FOUND",
	MISSING_QUERY: "MISSING_QUERY",
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

type Template = { error: string; hint: string }

const TEMPLATES: Record<ErrorCode, Template> = {
	INVALID_PAYLOAD: {
		error: "Invalid submission",
		hint: "Some required info is missing or doesn't look right. Make sure the song name, artist, video, and lyrics are all filled in.",
	},
	SONG_TOO_LONG: {
		error: "Song name too long",
		hint: "The song name is too long. Try a shorter version.",
	},
	ARTIST_TOO_LONG: {
		error: "Artist name too long",
		hint: "The artist name is too long. Try a shorter version.",
	},
	PAYLOAD_TOO_LARGE: {
		error: "Lyrics too large",
		hint: "These lyrics are too big to submit. If there's extra formatting or notes mixed in with the text, try cleaning those out first.",
	},
	INVALID_DURATION: {
		error: "Song length looks off",
		hint: "The song length doesn't look right. Double-check that it matches the actual track length.",
	},
	TTML_MALFORMED: {
		error: "Broken TTML file",
		hint: "The TTML file looks incomplete or broken. Try re-exporting it from your lyrics tool and submitting again.",
	},
	TTML_FORMATTED: {
		error: "TTML formatting issue",
		hint: "The TTML file has extra formatting that breaks the word-by-word timing. Try re-exporting it without any auto-formatting or pretty-printing.",
	},
	RATE_LIMITED: {
		error: "Slow down",
		hint: "You're submitting too quickly. Wait a moment and try again.",
	},
	VARIANT_CAP_REACHED: {
		error: "Too many submissions",
		hint: "You've already submitted the maximum number of versions for this song. Delete one of your existing submissions to add a new one.",
	},
	AUTH_REQUIRED: {
		error: "Sign in required",
		hint: "You need to be signed in to do this.",
	},
	INVALID_ID: {
		error: "Bad request",
		hint: "The link or ID doesn't look right. Double-check it and try again.",
	},
	NOT_OWNER: {
		error: "Not yours to delete",
		hint: "You can only delete submissions you made yourself.",
	},
	NOT_FOUND: {
		error: "Lyrics not found",
		hint: "Couldn't find lyrics for this. Try a different search, or be the first to submit them.",
	},
	MISSING_QUERY: {
		error: "Search needs more info",
		hint: "To search, add either a video link or both the song and artist names.",
	},
}

export type SubmissionErrorBody = {
	success: false
	error: string
	code: ErrorCode
	hint: string
}

export function buildError(
	code: ErrorCode,
	overrides?: { error?: string; hint?: string },
): SubmissionErrorBody {
	const template = TEMPLATES[code]
	return {
		success: false,
		error: overrides?.error ?? template.error,
		code,
		hint: overrides?.hint ?? template.hint,
	}
}
