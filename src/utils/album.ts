import { config } from "@/config"

export const ALBUM_HINT = `Album names must be a single line of up to ${config.validation.album.maxLength} characters.`

export function isValidAlbum(album: string): boolean {
	return album.length <= config.validation.album.maxLength && !/[\p{Cc}\u2028\u2029]/u.test(album)
}
