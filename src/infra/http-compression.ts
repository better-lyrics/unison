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

function withAcceptEncoding(vary: string | number | undefined): string {
	if (vary === undefined || vary === "") return "Accept-Encoding"
	const value = String(vary)
	const tokens = value.split(",").map((t) => t.trim().toLowerCase())
	if (tokens.includes("*") || tokens.includes("accept-encoding")) return value
	return `${value}, Accept-Encoding`
}

function isJsonBody(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false
	if (value instanceof Response) return false
	return Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype
}

export const httpCompression = new Elysia({ name: "http-compression" }).mapResponse(
	{ as: "global" },
	async (context) => {
		const { request, responseValue, set } = context
		const isStatus = responseValue instanceof ElysiaCustomStatusResponse
		const body: unknown = isStatus ? responseValue.response : responseValue
		if (!isJsonBody(body)) return
		set.headers.vary = withAcceptEncoding(set.headers.vary)
		// Elysia's onError path sends whatever mapResponse returns, even undefined.
		const mustRespond = "error" in context
		const accepts = acceptsGzip(request.headers.get("accept-encoding"))
		if (!accepts && !mustRespond) return
		const json = JSON.stringify(body)
		const compress = accepts && json.length >= config.http.compressMinBytes
		if (!compress && !mustRespond) return
		if (compress) set.headers["content-encoding"] = "gzip"
		return new Response(compress ? await gzip(json) : json, {
			status: isStatus ? responseValue.code : undefined,
			headers: { "content-type": "application/json" },
		})
	}
)
