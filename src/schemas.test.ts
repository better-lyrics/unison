import { describe, expect, it } from "vitest"
import {
	IdParamSchema,
	LyricsSubmissionSchema,
	ReportSchema,
	SongArtistQuerySchema,
	VideoIdQuerySchema,
	VoteSchema,
} from "./schemas"

describe("VideoIdQuerySchema", () => {
	it("validates valid query with videoId", () => {
		const result = VideoIdQuerySchema({ v: "dQw4w9WgXcQ" })
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toEqual({ v: "dQw4w9WgXcQ" })
	})

	it("rejects missing videoId", () => {
		const result = VideoIdQuerySchema({})
		expect(result.toString()).toContain("v")
	})

	it("rejects empty videoId", () => {
		const result = VideoIdQuerySchema({ v: "" })
		expect(result.toString()).toContain("v")
	})
})

describe("SongArtistQuerySchema", () => {
	it("validates valid query with song and artist", () => {
		const result = SongArtistQuerySchema({ song: "Test Song", artist: "Test Artist" })
		expect(result).not.toBeInstanceOf(Error)
	})

	it("validates with optional duration", () => {
		const result = SongArtistQuerySchema({
			song: "Test Song",
			artist: "Test Artist",
			duration: "180000",
		})
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toHaveProperty("duration", 180000)
	})

	it("rejects missing song", () => {
		const result = SongArtistQuerySchema({ artist: "Test Artist" })
		expect(result.toString()).toContain("song")
	})

	it("rejects missing artist", () => {
		const result = SongArtistQuerySchema({ song: "Test Song" })
		expect(result.toString()).toContain("artist")
	})
})

describe("LyricsSubmissionSchema", () => {
	const validSubmission = {
		videoId: "dQw4w9WgXcQ",
		song: "Never Gonna Give You Up",
		artist: "Rick Astley",
		duration: 213000,
		lyrics: "[00:15.00]Never gonna give you up",
		format: "lrc",
	}

	it("validates valid submission", () => {
		const result = LyricsSubmissionSchema(validSubmission)
		expect(result).not.toBeInstanceOf(Error)
	})

	it("validates submission with optional fields", () => {
		const result = LyricsSubmissionSchema({
			...validSubmission,
			album: "Whenever You Need Somebody",
			language: "en",
			syncType: "linesync",
		})
		expect(result).not.toBeInstanceOf(Error)
	})

	it("rejects missing videoId", () => {
		const { videoId: _, ...rest } = validSubmission
		const result = LyricsSubmissionSchema(rest)
		expect(result.toString()).toContain("videoId")
	})

	it("rejects missing song", () => {
		const { song: _, ...rest } = validSubmission
		const result = LyricsSubmissionSchema(rest)
		expect(result.toString()).toContain("song")
	})

	it("rejects empty song", () => {
		const result = LyricsSubmissionSchema({ ...validSubmission, song: "" })
		expect(result.toString()).toContain("song")
	})

	it("rejects duration below minimum", () => {
		const result = LyricsSubmissionSchema({ ...validSubmission, duration: 500 })
		expect(result.toString()).toContain("duration")
	})

	it("rejects duration above maximum", () => {
		const result = LyricsSubmissionSchema({ ...validSubmission, duration: 3700000 })
		expect(result.toString()).toContain("duration")
	})

	it("rejects invalid syncType", () => {
		const result = LyricsSubmissionSchema({ ...validSubmission, syncType: "invalid" })
		expect(result.toString()).toContain("syncType")
	})

	it("accepts valid syncType values", () => {
		for (const syncType of ["richsync", "linesync", "plain"]) {
			const result = LyricsSubmissionSchema({ ...validSubmission, syncType })
			expect(result).not.toBeInstanceOf(Error)
		}
	})
})

describe("VoteSchema", () => {
	it("validates upvote", () => {
		const result = VoteSchema({ vote: 1 })
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toEqual({ vote: 1 })
	})

	it("validates downvote", () => {
		const result = VoteSchema({ vote: -1 })
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toEqual({ vote: -1 })
	})

	it("rejects zero vote", () => {
		const result = VoteSchema({ vote: 0 })
		expect(result.toString()).toContain("vote")
	})

	it("rejects invalid vote value", () => {
		const result = VoteSchema({ vote: 2 })
		expect(result.toString()).toContain("vote")
	})

	it("rejects missing vote", () => {
		const result = VoteSchema({})
		expect(result.toString()).toContain("vote")
	})
})

describe("ReportSchema", () => {
	it("validates valid report with reason only", () => {
		const result = ReportSchema({ reason: "wrong_song" })
		expect(result).not.toBeInstanceOf(Error)
	})

	it("validates report with details", () => {
		const result = ReportSchema({
			reason: "bad_sync",
			details: "The timing is off by 2 seconds",
		})
		expect(result).not.toBeInstanceOf(Error)
	})

	it("validates all valid reasons", () => {
		const reasons = ["wrong_song", "bad_sync", "offensive", "spam", "other"]
		for (const reason of reasons) {
			const result = ReportSchema({ reason })
			expect(result).not.toBeInstanceOf(Error)
		}
	})

	it("rejects invalid reason", () => {
		const result = ReportSchema({ reason: "invalid_reason" })
		expect(result.toString()).toContain("reason")
	})

	it("rejects missing reason", () => {
		const result = ReportSchema({})
		expect(result.toString()).toContain("reason")
	})
})

describe("IdParamSchema", () => {
	it("parses valid numeric id", () => {
		const result = IdParamSchema({ id: "123" })
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toEqual({ id: 123 })
	})

	it("parses zero", () => {
		const result = IdParamSchema({ id: "0" })
		expect(result).not.toBeInstanceOf(Error)
		expect(result).toEqual({ id: 0 })
	})

	it("rejects non-numeric id", () => {
		const result = IdParamSchema({ id: "abc" })
		expect(result.toString()).toContain("id")
	})

	it("rejects missing id", () => {
		const result = IdParamSchema({})
		expect(result.toString()).toContain("id")
	})
})
