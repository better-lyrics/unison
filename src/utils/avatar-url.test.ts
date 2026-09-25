import { config } from "@/config"
import { AVATAR_PRESETS } from "@/db/avatar-presets"
import { describe, expect, it } from "vitest"
import { avatarUrlFor, discordAvatarUrl } from "./avatar-url"

const DISCORD_ID = "123456789012345678"

describe("discordAvatarUrl", () => {
	it("builds a png url with a size for a static hash", () => {
		const url = discordAvatarUrl(DISCORD_ID, "abc123")
		expect(url).toBe(`https://cdn.discordapp.com/avatars/${DISCORD_ID}/abc123.png?size=128`)
	})
	it("uses .gif for an animated (a_) hash", () => {
		const url = discordAvatarUrl(DISCORD_ID, "a_deadbeef")
		expect(url).toBe(`https://cdn.discordapp.com/avatars/${DISCORD_ID}/a_deadbeef.gif?size=128`)
	})
	it("honours a custom size", () => {
		expect(discordAvatarUrl(DISCORD_ID, "abc", 256)).toContain("?size=256")
	})
})

describe("avatarUrlFor", () => {
	const preset = AVATAR_PRESETS[0]

	it("returns null for the generated default (null type)", () => {
		expect(
			avatarUrlFor({
				avatarType: null,
				avatarRef: null,
				discordId: null,
				discordAvatar: null,
				artworkUrl: null,
			})
		).toBeNull()
	})

	it("returns the preset CDN url for a known preset", () => {
		expect(
			avatarUrlFor({
				avatarType: "preset",
				avatarRef: preset.id,
				discordId: null,
				discordAvatar: null,
				artworkUrl: null,
			})
		).toBe(config.avatar.cdnBase + preset.file)
	})

	it("returns the discord url when type is discord and a hash exists", () => {
		expect(
			avatarUrlFor({
				avatarType: "discord",
				avatarRef: DISCORD_ID,
				discordId: DISCORD_ID,
				discordAvatar: "abc123",
				artworkUrl: null,
			})
		).toBe(discordAvatarUrl(DISCORD_ID, "abc123"))
	})

	describe("edge cases", () => {
		it("returns null (falls to default) for an unknown preset ref", () => {
			expect(
				avatarUrlFor({
					avatarType: "preset",
					avatarRef: "gone",
					discordId: null,
					discordAvatar: null,
					artworkUrl: null,
				})
			).toBeNull()
		})
		it("discord picked but no link (null id/hash) falls to default", () => {
			expect(
				avatarUrlFor({
					avatarType: "discord",
					avatarRef: DISCORD_ID,
					discordId: null,
					discordAvatar: null,
					artworkUrl: null,
				})
			).toBeNull()
		})
		it("discord picked, linked, but null hash falls to default", () => {
			expect(
				avatarUrlFor({
					avatarType: "discord",
					avatarRef: DISCORD_ID,
					discordId: DISCORD_ID,
					discordAvatar: null,
					artworkUrl: null,
				})
			).toBeNull()
		})
		it("preset type with null ref falls to default", () => {
			expect(
				avatarUrlFor({
					avatarType: "preset",
					avatarRef: null,
					discordId: null,
					discordAvatar: null,
					artworkUrl: null,
				})
			).toBeNull()
		})
		it("unknown avatar type falls to default", () => {
			expect(
				avatarUrlFor({
					avatarType: "upload",
					avatarRef: "x",
					discordId: DISCORD_ID,
					discordAvatar: "abc",
					artworkUrl: null,
				})
			).toBeNull()
		})
	})

	describe("song cover", () => {
		const ART = "https://yt3.googleusercontent.com/abc=w544-h544-l90-rj"
		const song = (artworkUrl: string | null, avatarRef = "dQw4w9WgXcQ") =>
			avatarUrlFor({
				avatarType: "song",
				avatarRef,
				discordId: null,
				discordAvatar: null,
				artworkUrl,
			})

		it("returns the cover resized to the avatar size", () => {
			const size = config.avatar.artworkSize
			expect(song(ART)).toBe(`https://yt3.googleusercontent.com/abc=w${size}-h${size}-l90-rj`)
		})
		it("falls to default when the song has no cover", () => {
			expect(song(null)).toBeNull()
		})
		it("never resolves a preset id stored as a song ref", () => {
			expect(song(null, preset.id)).toBeNull()
		})
		it("a preset pick ignores a joined cover", () => {
			expect(
				avatarUrlFor({
					avatarType: "preset",
					avatarRef: preset.id,
					discordId: null,
					discordAvatar: null,
					artworkUrl: ART,
				})
			).toBe(config.avatar.cdnBase + preset.file)
		})
	})

	describe("regressions", () => {
		it("regression: a discord pick never shows a different linked account's photo", () => {
			expect(
				avatarUrlFor({
					avatarType: "discord",
					avatarRef: DISCORD_ID,
					discordId: "999999999999999999",
					discordAvatar: "other",
					artworkUrl: null,
				})
			).toBeNull()
		})
		it("regression: a discord pick without the chosen account id falls to default", () => {
			expect(
				avatarUrlFor({
					avatarType: "discord",
					avatarRef: null,
					discordId: DISCORD_ID,
					discordAvatar: "abc123",
					artworkUrl: null,
				})
			).toBeNull()
		})
	})

	describe("invariants", () => {
		it("every preset resolves to a url under the CDN base", () => {
			for (const p of AVATAR_PRESETS) {
				const url = avatarUrlFor({
					avatarType: "preset",
					avatarRef: p.id,
					discordId: null,
					discordAvatar: null,
					artworkUrl: null,
				})
				expect(url).toBe(`${config.avatar.cdnBase}${p.file}`)
				expect(() => new URL(url ?? "")).not.toThrow()
			}
		})
		it("the avatar cover size is 256", () => {
			expect(config.avatar.artworkSize).toBe(256)
		})
		it("a preset pick ignores any discord data", () => {
			expect(
				avatarUrlFor({
					avatarType: "preset",
					avatarRef: preset.id,
					discordId: DISCORD_ID,
					discordAvatar: "abc",
					artworkUrl: null,
				})
			).toBe(config.avatar.cdnBase + preset.file)
		})
	})
})
