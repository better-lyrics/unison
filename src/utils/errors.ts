// The `code` field is the stable contract for clients; switch on it.
// The `error` and `hint` fields are display copy and may be reworded.
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
	INVALID_SIGNED_BODY: "INVALID_SIGNED_BODY",
	TIMESTAMP_EXPIRED: "TIMESTAMP_EXPIRED",
	NONCE_REPLAY: "NONCE_REPLAY",
	PUBLIC_KEY_REQUIRED: "PUBLIC_KEY_REQUIRED",
	KEY_ID_MISMATCH: "KEY_ID_MISMATCH",
	INVALID_SIGNATURE: "INVALID_SIGNATURE",
	INVALID_VOTE: "INVALID_VOTE",
	INVALID_REPORT_REASON: "INVALID_REPORT_REASON",
	REPORT_DETAILS_TOO_LONG: "REPORT_DETAILS_TOO_LONG",
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
	INVALID_SIGNED_BODY: {
		error: "Request looks broken",
		hint: "Something looks off with this request. Try again. If it keeps happening, the extension may need an update.",
	},
	TIMESTAMP_EXPIRED: {
		error: "Request expired",
		hint: "This took too long to reach us, or your device's clock might be off. Check the time on your device and try again.",
	},
	NONCE_REPLAY: {
		error: "Already received",
		hint: "We already received this exact request. If you meant to send a new submission, refresh and try again.",
	},
	PUBLIC_KEY_REQUIRED: {
		error: "Setup incomplete",
		hint: "This device isn't fully set up yet. Try again in a moment. If it keeps happening, the extension may need an update.",
	},
	KEY_ID_MISMATCH: {
		error: "Identity check failed",
		hint: "Something's off with how this request was signed. Try again. If it keeps happening, the extension may need an update.",
	},
	INVALID_SIGNATURE: {
		error: "Signature check failed",
		hint: "Couldn't verify this request. Try again. If it keeps happening, the extension may need an update.",
	},
	INVALID_VOTE: {
		error: "Vote failed",
		hint: "Couldn't register your vote. Try again. If it keeps happening, the extension may need an update.",
	},
	INVALID_REPORT_REASON: {
		error: "Report failed",
		hint: "Couldn't submit this report. Pick one of the available reasons and try again.",
	},
	REPORT_DETAILS_TOO_LONG: {
		error: "Report details too long",
		hint: "The extra details on this report are too long. Try a shorter explanation (under 1000 characters).",
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
