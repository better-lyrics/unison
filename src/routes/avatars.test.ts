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
	} as unknown as Env
}

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
