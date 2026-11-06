import { config } from "@/config"
import {
	type RenderedCard,
	renderProfileDownload,
	renderProfileOg,
	renderSongOg,
} from "@/og/render"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { isVideoId } from "@/utils/video-id"
import { Elysia } from "elysia"

type Renderer = (env: Env, id: string) => Promise<RenderedCard | null>

interface Renderers {
	song: Renderer
	profile: Renderer
	download: Renderer
}

const KEY_ID = /^[0-9a-fA-F]{64}$/

const recent = new Map<string, Promise<RenderedCard | null>>()

function remember(url: string, load: () => Promise<RenderedCard | null>) {
	const hit = recent.get(url)
	if (hit) {
		recent.delete(url)
		recent.set(url, hit)
		return hit
	}
	const pending = load().then(
		(card) => {
			if (!card) recent.delete(url)
			return card
		},
		(error: unknown) => {
			recent.delete(url)
			throw error
		}
	)
	recent.set(url, pending)
	if (recent.size > config.og.memoryEntries) {
		const oldest = recent.keys().next().value
		if (oldest !== undefined) recent.delete(oldest)
	}
	return pending
}

export const ogRoutes = (
	env: Env,
	renderers: Renderers = {
		song: renderSongOg,
		profile: renderProfileOg,
		download: renderProfileDownload,
	}
) => {
	const serve = async (
		{
			request,
			params,
			set,
		}: { request: Request; params: { file: string }; set: { status?: number | string } },
		ext: "jpg" | "png",
		valid: (id: string) => boolean,
		renderer: Renderer
	) => {
		const { file } = params
		const id = file.endsWith(`.${ext}`) ? file.slice(0, -ext.length - 1) : ""
		if (!valid(id)) {
			set.status = 400
			return buildError(ErrorCode.INVALID_ID)
		}
		const url = new URL(request.url)
		const card = await remember(url.pathname + url.search, () => renderer(env, id))
		if (!card) {
			set.status = 404
			return buildError(ErrorCode.NOT_FOUND)
		}
		return new Response(new Uint8Array(card.bytes), {
			headers: {
				"content-type": ext === "jpg" ? "image/jpeg" : "image/png",
				"cache-control": config.og.cacheControl,
			},
		})
	}
	const isKeyId = (id: string) => KEY_ID.test(id)

	return new Elysia()
		.decorate("env", env)
		.use(readRateLimit)
		.get("/og/song/:file", (ctx) => serve(ctx, "jpg", isVideoId, renderers.song))
		.get("/og/user/:file", (ctx) => serve(ctx, "jpg", isKeyId, renderers.profile))
		.get("/card/user/:file", (ctx) => serve(ctx, "png", isKeyId, renderers.download))
}
