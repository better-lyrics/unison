import { readFileSync, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { SPA_CONTENT_SECURITY_POLICY } from "@/utils/content-security-policy"

// @elysiajs/static on the Node adapter omits content-type headers and ignores
// indexHTML for unmatched routes, so we serve the SPA dist ourselves.
const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
}

export interface Spa {
	dist: string
	indexHtml: string | null
}

export function loadSpa(dist: string): Spa {
	let indexHtml: string | null = null
	try {
		indexHtml = readFileSync(resolve(dist, "index.html"), "utf8")
	} catch {
		indexHtml = null
	}
	return { dist, indexHtml }
}

function readSpaFile(dist: string, pathname: string): { body: Buffer; ext: string } | null {
	const cleaned = pathname.replace(/^\/+/, "")
	if (!cleaned) return null
	const fullPath = resolve(dist, cleaned)
	if (fullPath !== dist && !fullPath.startsWith(`${dist}${sep}`)) return null
	try {
		if (!statSync(fullPath).isFile()) return null
	} catch {
		return null
	}
	return { body: readFileSync(fullPath), ext: extname(fullPath).toLowerCase() }
}

function htmlDocument(body: string | Buffer): Response {
	return new Response(body, {
		status: 200,
		headers: {
			"content-type": MIME_TYPES[".html"],
			"content-security-policy": SPA_CONTENT_SECURITY_POLICY,
		},
	})
}

export function serveSpa(pathname: string, spa: Spa): Response | null {
	if (!pathname.includes(".")) return spa.indexHtml ? htmlDocument(spa.indexHtml) : null

	const file = readSpaFile(spa.dist, pathname)
	if (!file) return null
	if (file.ext === ".html") return htmlDocument(file.body)
	return new Response(file.body, {
		status: 200,
		headers: {
			"content-type": MIME_TYPES[file.ext] ?? "application/octet-stream",
			"cache-control": "public, max-age=31536000, immutable",
		},
	})
}
