export const API_PREFIXES = [
	"/lyrics",
	"/feed",
	"/votes",
	"/requests",
	"/leaderboard",
	"/users",
	"/auth",
	"/health",
	"/getLyrics",
]

export function isApiPath(pathname: string): boolean {
	return API_PREFIXES.some(
		(prefix) => pathname.startsWith(`${prefix}/`) && pathname.length > prefix.length + 1
	)
}
