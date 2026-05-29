import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"
import { createStorage } from "./storage"

const cfg = {
	keyId: "k",
	applicationKey: "s",
	bucket: "test-bucket",
	endpoint: "https://example.invalid",
}

describe("createStorage", () => {
	it("returns null when B2 config is missing", () => {
		expect(createStorage(null)).toBeNull()
	})

	it("putObject sends a PutObjectCommand with bucket, key, body, and content type", async () => {
		const sendMock = vi.fn().mockResolvedValue({})
		const storage = createStorage(cfg)
		if (!storage) throw new Error("storage should not be null")
		storage.__client.send = sendMock as typeof storage.__client.send

		const body = Buffer.from("hi")
		await storage.putObject("dumps/foo.dump", body, "application/octet-stream")

		expect(sendMock).toHaveBeenCalledOnce()
		const cmd = sendMock.mock.calls[0][0]
		expect(cmd).toBeInstanceOf(PutObjectCommand)
		expect(cmd.input.Bucket).toBe("test-bucket")
		expect(cmd.input.Key).toBe("dumps/foo.dump")
		expect(cmd.input.Body).toBe(body)
		expect(cmd.input.ContentType).toBe("application/octet-stream")
	})

	it("listObjects sends a ListObjectsV2Command and maps Contents to key + lastModified", async () => {
		const lastModified = new Date("2026-05-29T04:00:00Z")
		const sendMock = vi.fn().mockResolvedValue({
			Contents: [
				{ Key: "dumps/a.dump", LastModified: lastModified },
				{ Key: "dumps/b.dump", LastModified: lastModified },
			],
		})
		const storage = createStorage(cfg)
		if (!storage) throw new Error("storage should not be null")
		storage.__client.send = sendMock as typeof storage.__client.send

		const result = await storage.listObjects("dumps/")

		expect(sendMock).toHaveBeenCalledOnce()
		const cmd = sendMock.mock.calls[0][0]
		expect(cmd).toBeInstanceOf(ListObjectsV2Command)
		expect(cmd.input.Bucket).toBe("test-bucket")
		expect(cmd.input.Prefix).toBe("dumps/")
		expect(result).toEqual([
			{ key: "dumps/a.dump", lastModified },
			{ key: "dumps/b.dump", lastModified },
		])
	})

	it("listObjects returns [] when Contents is missing", async () => {
		const sendMock = vi.fn().mockResolvedValue({})
		const storage = createStorage(cfg)
		if (!storage) throw new Error("storage should not be null")
		storage.__client.send = sendMock as typeof storage.__client.send

		expect(await storage.listObjects("dumps/")).toEqual([])
	})

	it("deleteObject sends a DeleteObjectCommand with bucket and key", async () => {
		const sendMock = vi.fn().mockResolvedValue({})
		const storage = createStorage(cfg)
		if (!storage) throw new Error("storage should not be null")
		storage.__client.send = sendMock as typeof storage.__client.send

		await storage.deleteObject("dumps/old.dump")

		expect(sendMock).toHaveBeenCalledOnce()
		const cmd = sendMock.mock.calls[0][0]
		expect(cmd).toBeInstanceOf(DeleteObjectCommand)
		expect(cmd.input.Bucket).toBe("test-bucket")
		expect(cmd.input.Key).toBe("dumps/old.dump")
	})
})
