import type { B2Config } from "@/types"
import {
	DeleteObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type PutObjectCommandInput,
	S3Client,
} from "@aws-sdk/client-s3"

export interface Storage {
	putObject(
		key: string,
		body: Buffer | NodeJS.ReadableStream,
		contentType: string,
		contentLength?: number
	): Promise<void>
	listObjects(prefix: string): Promise<{ key: string; lastModified: Date }[]>
	deleteObject(key: string): Promise<void>
	__client: S3Client
}

export function createStorage(cfg: B2Config | null): Storage | null {
	if (!cfg) return null

	const client = new S3Client({
		endpoint: cfg.endpoint,
		region: "us-east-1",
		credentials: {
			accessKeyId: cfg.keyId,
			secretAccessKey: cfg.applicationKey,
		},
		forcePathStyle: true,
	})

	return {
		__client: client,
		async putObject(key, body, contentType, contentLength) {
			await client.send(
				new PutObjectCommand({
					Bucket: cfg.bucket,
					Key: key,
					Body: body as PutObjectCommandInput["Body"],
					ContentType: contentType,
					ContentLength: contentLength,
				})
			)
		},
		async listObjects(prefix) {
			const res = await client.send(
				new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix })
			)
			return (res.Contents ?? [])
				.filter((o) => o.Key && o.LastModified)
				.map((o) => ({ key: o.Key as string, lastModified: o.LastModified as Date }))
		},
		async deleteObject(key) {
			await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
		},
	}
}
