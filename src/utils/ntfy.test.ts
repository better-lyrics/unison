import { afterEach, describe, expect, it, vi } from "vitest"
import { notify } from "@/utils/ntfy"

const ORIGINAL = process.env.NTFY_TOPIC_URL

afterEach(() => {
	process.env.NTFY_TOPIC_URL = ORIGINAL
	vi.unstubAllGlobals()
})

describe("notify", () => {
	it("returns false and does not fetch when the topic url is unset", async () => {
		process.env.NTFY_TOPIC_URL = ""
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)
		const ok = await notify("hello", { title: "t" })
		expect(ok).toBe(false)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("posts the message body to the topic url and returns true on 2xx", async () => {
		process.env.NTFY_TOPIC_URL = "https://ntfy.sh/unison-thresholds"
		const fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const ok = await notify("body text", { title: "Threshold drift" })
		expect(ok).toBe(true)
		const [url, init] = fetchSpy.mock.calls[0]
		expect(url).toBe("https://ntfy.sh/unison-thresholds")
		expect(init.method).toBe("POST")
		expect(init.body).toBe("body text")
		expect(init.headers.Title).toBe("Threshold drift")
	})

	it("returns false on a non-2xx response without throwing", async () => {
		process.env.NTFY_TOPIC_URL = "https://ntfy.sh/unison-thresholds"
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
		await expect(notify("x")).resolves.toBe(false)
	})

	it("swallows fetch rejections and returns false", async () => {
		process.env.NTFY_TOPIC_URL = "https://ntfy.sh/unison-thresholds"
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
		await expect(notify("x")).resolves.toBe(false)
	})
})
