const SPA_DIRECTIVES: Record<string, string[]> = {
	"default-src": ["'self'"],
	"script-src": ["'self'", "https://www.youtube.com", "https://static.cloudflareinsights.com"],
	"style-src": ["'self'", "'unsafe-inline'", "https://api.fontshare.com", "https://fonts.googleapis.com"],
	"font-src": ["'self'", "data:", "https://cdn.fontshare.com", "https://fonts.gstatic.com"],
	"img-src": [
		"'self'",
		"data:",
		"https://cdn.betterlyrics.org",
		"https://i.ytimg.com",
		"https://*.googleusercontent.com",
		"https://cdn.discordapp.com",
		"https://github.com",
		"https://avatars.githubusercontent.com",
	],
	"connect-src": ["'self'", "https://unison-dumps.boidu.dev", "https://cloudflareinsights.com"],
	"frame-src": ["https://www.youtube.com"],
	"object-src": ["'none'"],
	"base-uri": ["'self'"],
	"form-action": ["'self'"],
	"frame-ancestors": ["'none'"],
}

export const SPA_CONTENT_SECURITY_POLICY = Object.entries(SPA_DIRECTIVES)
	.map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
	.join("; ")
