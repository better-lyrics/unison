import { type } from "arktype"
import { config } from "./config"

// Primary lookup by videoId
export const VideoIdQuerySchema = type({
	v: "string>0",
})

// Alternative lookup by song/artist
export const SongArtistQuerySchema = type({
	song: "string>0",
	artist: "string>0",
	"album?": "string | undefined",
	"duration?": "string.numeric.parse | undefined",
})

export const LyricsSubmissionSchema = type({
	videoId: "string>0",
	song: `string>0&string<=${config.validation.song.maxLength}`,
	artist: `string>0&string<=${config.validation.artist.maxLength}`,
	duration: `number>=${config.validation.duration.min}&number<=${config.validation.duration.max}`,
	lyrics: `string>0&string<=${config.validation.ttml.maxSizeBytes}`,
	format: "'ttml'|'lrc'|'plain'",
	"album?": `string<=${config.validation.album.maxLength}`,
	"language?": "string",
	"syncType?": "'richsync'|'linesync'|'plain'",
})

export const VoteSchema = type({
	vote: "1|-1",
})

export const ReportSchema = type({
	reason: "'wrong_song'|'bad_sync'|'offensive'|'spam'|'other'",
	"details?": `string<=${config.validation.report.maxDetailsLength}`,
})

export const IdParamSchema = type({
	id: "string.numeric.parse",
})

export type VideoIdQuery = typeof VideoIdQuerySchema.infer
export type SongArtistQuery = typeof SongArtistQuerySchema.infer
export type LyricsSubmissionInput = typeof LyricsSubmissionSchema.infer
export type VoteInput = typeof VoteSchema.infer
export type ReportInput = typeof ReportSchema.infer
