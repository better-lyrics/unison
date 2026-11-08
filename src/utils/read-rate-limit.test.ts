import { describe, expect, it } from "vitest"
import { config } from "@/config"
import { clientIp, readBucket } from "./read-rate-limit"

describe("clientIp", () => {
	it("uses first hop of X-Forwarded-For", () => {
		expect(clientIp({ "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4")
	})

	it("strips whitespace and takes left-most when XFF has multiple hops", () => {
		expect(clientIp({ "x-forwarded-for": "  1.2.3.4 , 10.0.0.1, 172.16.0.1" })).toBe("1.2.3.4")
	})

	it("falls back to X-Real-IP when XFF is absent", () => {
		expect(clientIp({ "x-real-ip": "5.6.7.8" })).toBe("5.6.7.8")
	})

	it("prefers X-Forwarded-For over X-Real-IP when both present", () => {
		expect(clientIp({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" })).toBe("1.2.3.4")
	})

	it("returns 'unknown' when neither header is set", () => {
		expect(clientIp({})).toBe("unknown")
	})

	it("returns 'unknown' for explicitly undefined values", () => {
		expect(clientIp({ "x-forwarded-for": undefined, "x-real-ip": undefined })).toBe("unknown")
	})
})

describe("readBucket", () => {
	it("gives same-origin SPA requests their own larger bucket", () => {
		expect(readBucket({ "x-forwarded-for": "1.2.3.4", "sec-fetch-site": "same-origin" })).toEqual({
			key: "spa:ip:1.2.3.4",
			scale: config.rateLimit.spaReadScale,
		})
	})

	it("keeps every other client on the shared per-IP bucket", () => {
		for (const site of ["cross-site", "same-site", "none", undefined]) {
			expect(readBucket({ "x-forwarded-for": "1.2.3.4", "sec-fetch-site": site })).toEqual({
				key: "ip:1.2.3.4",
				scale: 1,
			})
		}
	})
})
