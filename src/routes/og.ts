import { config } from "@/config"
import { PAGES, type Page } from "@/og/page-cards"
import {
	type RenderedCard,
	loadPageCard,
	renderPageOg,
	renderProfileDownload,
	renderProfileOg,
	renderSongOg,
} from "@/og/render"
import { oembedFor, shareLoaders } from "@/share-meta"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { isVideoId } from "@/utils/video-id"
import { Elysia, t } from "elysia"

type Renderer = (env: Env, id: string) => Promise<RenderedCard | null>

const KEY_ID = /^[0-9a-fA-F]{64}$/

export function cardMemoKey(url: string, version: string): string {
	return `${new URL(url).pathname}:${version}`
}

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

export const ogRoutes = (env: Env) => {
	const serve = async (
		{
			request,
			params,
			set,
		}: { request: Request; params: { file: string }; set: { status?: number | string } },
		ext: "jpg" | "png",
		valid: (id: string) => boolean,
		share: (env: Env, id: string) => Promise<{ version: string } | null>,
		renderer: Renderer,
		cacheControl: string
	) => {
		const { file } = params
		const id = file.endsWith(`.${ext}`) ? file.slice(0, -ext.length - 1) : ""
		if (!valid(id)) {
			set.status = 400
			return buildError(ErrorCode.INVALID_ID)
		}
		const current = await share(env, id)
		const card = current
			? await remember(cardMemoKey(request.url, current.version), () => renderer(env, id))
			: null
		if (!card) {
			set.status = 404
			return buildError(ErrorCode.NOT_FOUND)
		}
		return new Response(new Uint8Array(card.bytes), {
			headers: {
				"content-type": ext === "jpg" ? "image/jpeg" : "image/png",
				"cache-control": cacheControl,
			},
		})
	}
	const isKeyId = (id: string) => KEY_ID.test(id)
	const isPage = (id: string): id is Page => (PAGES as readonly string[]).includes(id)
	const renderPage = async (env: Env, page: string) =>
		isPage(page) ? renderPageOg(env, await loadPageCard(env, page)) : null

	return new Elysia()
		.decorate("env", env)
		.use(readRateLimit)
		.get("/og/song/:file", (ctx) =>
			serve(ctx, "jpg", isVideoId, shareLoaders.song, renderSongOg, config.og.cacheControl)
		)
		.get("/og/user/:file", (ctx) =>
			serve(ctx, "jpg", isKeyId, shareLoaders.profile, renderProfileOg, config.og.cacheControl)
		)
		.get("/og/page/:file", (ctx) =>
			serve(
				ctx,
				"jpg",
				isPage,
				(env, page) => shareLoaders.page(env, page as Page),
				renderPage,
				config.og.cacheControl
			)
		)
		.get("/card/user/:file", (ctx) =>
			serve(
				ctx,
				"png",
				isKeyId,
				shareLoaders.profile,
				renderProfileDownload,
				config.og.downloadCacheControl
			)
		)
		.get(
			"/oembed",
			async ({ request, query, set }) => {
				const body = await oembedFor(env, request, query.url ?? "")
				if (!body) {
					set.status = 404
					return buildError(ErrorCode.NOT_FOUND)
				}
				set.headers["cache-control"] = "public, max-age=3600"
				return body
			},
			{ query: t.Object({ url: t.Optional(t.String()), format: t.Optional(t.String()) }) }
		)
}
