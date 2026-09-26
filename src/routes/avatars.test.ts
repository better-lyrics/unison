import { config } from "@/config"
import { AVATAR_PRESETS } from "@/db/avatar-presets"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { avatarRoutes } from "./avatars"

function makeEnv(): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: {} as Env["DB"],
		CACHE: {} as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		CDN: null,
		BUTLER_BOT_SECRET: "test-bot",
	} as unknown as Env
}

function makeCdn() {
	const puts: { key: string; contentType: string; bytes: number }[] = []
	const deletes: string[] = []
	const storage = {
		async putObject(key: string, body: Buffer, contentType: string) {
			puts.push({ key, contentType, bytes: body.length })
		},
		async listObjects() {
			return []
		},
		async deleteObject(key: string) {
			deletes.push(key)
		},
	} as unknown as NonNullable<Env["CDN"]>
	return { puts, deletes, storage }
}

interface PresetPostBody {
	success: boolean
	code?: string
	data?: { id: string; label: string; url: string }
}

async function postPreset(
	env: Env,
	body: unknown,
	auth: string | null = "test-bot"
): Promise<{ status: number; body: PresetPostBody }> {
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (auth) headers.authorization = `Bearer ${auth}`
	const res = await avatarRoutes(env).handle(
		new Request("http://localhost/avatars/presets", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		})
	)
	return { status: res.status, body: (await res.json()) as PresetPostBody }
}

const VALID_BODY = { id: "test-cat", label: "Test Cat", mime: "image/png", dataBase64: "AAAA" }

interface CatalogueBody {
	success: boolean
	data: {
		presets: { id: string; label: string; url: string }[]
		display: { cdnBase: string; artworkSize: number }
	}
}

async function getCatalogue(): Promise<{ res: Response; body: CatalogueBody }> {
	const res = await avatarRoutes(makeEnv()).handle(new Request("http://localhost/avatars"))
	return { res, body: (await res.json()) as CatalogueBody }
}

describe("GET /avatars", () => {
	it("returns every preset with its resolved CDN url and a display block", async () => {
		const { res, body } = await getCatalogue()
		expect(res.status).toBe(200)
		expect(body.success).toBe(true)
		expect(body.data.display).toEqual({
			cdnBase: config.avatar.cdnBase,
			artworkSize: config.avatar.artworkSize,
		})
		expect(body.data.presets).toEqual(
			AVATAR_PRESETS.map((p) => ({
				id: p.id,
				label: p.label,
				url: config.avatar.cdnBase + p.file,
			}))
		)
	})

	it("is publicly cacheable", async () => {
		const { res } = await getCatalogue()
		expect(res.headers.get("cache-control")).toContain("public")
	})

	describe("invariants", () => {
		it("never exposes the internal file name as a field", async () => {
			const { body } = await getCatalogue()
			for (const p of body.data.presets)
				expect(Object.keys(p).sort()).toEqual(["id", "label", "url"])
		})
	})
})

describe("POST /avatars/presets", () => {
	it("requires bot auth", async () => {
		const { status, body } = await postPreset(makeEnv(), VALID_BODY, null)
		expect(status).toBe(401)
		expect(body.code).toBe("AUTH_REQUIRED")
	})

	it("returns 503 when the CDN is not configured", async () => {
		const { status, body } = await postPreset(makeEnv(), VALID_BODY)
		expect(status).toBe(503)
		expect(body.code).toBe("CDN_UNAVAILABLE")
	})

	it("rejects an invalid id via body validation", async () => {
		const cdn = makeCdn()
		const env = { ...makeEnv(), CDN: cdn.storage }
		const { status } = await postPreset(env, { ...VALID_BODY, id: "Bad Id" })
		expect(status).toBe(422)
	})

	it("rejects an unsupported image mime with 422", async () => {
		const cdn = makeCdn()
		const env = { ...makeEnv(), CDN: cdn.storage }
		const { status, body } = await postPreset(env, {
			...VALID_BODY,
			mime: "image/svg+xml",
			dataBase64: "PHN2Zz48L3N2Zz4=",
		})
		expect(status).toBe(422)
		expect(body.code).toBe("AVATAR_IMAGE_INVALID")
		expect(cdn.puts).toHaveLength(0)
	})

	it("rejects an undecodable image with 422", async () => {
		const cdn = makeCdn()
		const env = { ...makeEnv(), CDN: cdn.storage }
		const { status, body } = await postPreset(env, {
			...VALID_BODY,
			mime: "image/png",
			dataBase64: Buffer.from("not an image").toString("base64"),
		})
		expect(status).toBe(422)
		expect(body.code).toBe("AVATAR_IMAGE_INVALID")
		expect(cdn.puts).toHaveLength(0)
	})
})
