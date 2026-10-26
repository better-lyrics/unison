import { promisify } from "node:util"
import { gzip as gzipCallback } from "node:zlib"
import { config } from "@/config"
import { Elysia, ElysiaCustomStatusResponse } from "elysia"

const gzip = promisify(gzipCallback)

function acceptsGzip(header: string | null): boolean {
	if (!header) return false
	return header.split(",").some((part) => {
		const [coding, ...params] = part.trim().toLowerCase().split(";")
		if (coding.trim() !== "gzip" && coding.trim() !== "*") return false
		const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="))
		return q === undefined || Number(q.slice(2)) > 0
	})
}

function isJsonBody(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false
	if (value instanceof Response) return false
	return Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype
}

export const httpCompression = new Elysia({ name: "http-compression" }).mapResponse(
	{ as: "global" },
	async ({ request, responseValue, set }) => {
		const isStatus = responseValue instanceof ElysiaCustomStatusResponse
		const body: unknown = isStatus ? responseValue.response : responseValue
		if (!isJsonBody(body)) return
		set.headers.vary = "Accept-Encoding"
		const json = JSON.stringify(body)
		if (json.length < config.http.compressMinBytes) return
		if (!acceptsGzip(request.headers.get("accept-encoding"))) return
		set.headers["content-encoding"] = "gzip"
		return new Response(await gzip(json), {
			status: isStatus ? responseValue.code : undefined,
			headers: { "content-type": "application/json; charset=utf-8" },
		})
	}
)
