#!/usr/bin/env tsx
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEnv } from "@/infra/env"
import { Logger } from "@/infra/logger"
import { buildManifest, materializeDumpSchema, runPgDump, verifyDump } from "@/jobs/dump"

const log = new Logger("dump:dry-run")

async function main() {
	if (!process.env.DATABASE_URL) {
		log.error("DATABASE_URL is required")
		process.exit(1)
	}

	const env = createEnv()

	const dateStr = new Date().toISOString().slice(0, 10)
	const localPath = join(tmpdir(), `unison-${dateStr}-dryrun.dump`)
	const datedKey = `dumps/unison-${dateStr}.dump`

	log.info("Unison dump dry run", { localPath })

	let exitCode = 0
	try {
		log.info("materializing public_dump schema")
		await materializeDumpSchema(env)

		log.info("running pg_dump")
		await runPgDump({ databaseUrl: process.env.DATABASE_URL, outPath: localPath })

		log.info("verifying dump")
		const { sha256, bytes } = await verifyDump(localPath)
		log.info("dump verified", {
			sha256,
			bytes,
			mb: (bytes / 1024 / 1024).toFixed(2),
		})

		log.info("building manifest")
		const manifest = await buildManifest(env, {
			sha256,
			bytes,
			datedKey,
			publicBaseUrl: env.DUMP_PUBLIC_BASE_URL || "https://dumps.unison.example",
		})
		log.info("manifest ready", manifest as unknown as Record<string, unknown>)

		console.log("\nmanifest preview:")
		console.log(JSON.stringify(manifest, null, 2))

		log.info("dry run complete. Artifact retained for inspection", { localPath })
	} catch (err) {
		log.error("dry run failed", { error: (err as Error).message })
		exitCode = 1
	} finally {
		try {
			await env.DB.prepare("DROP SCHEMA IF EXISTS public_dump CASCADE").run()
		} catch (cleanupErr) {
			log.warn("schema cleanup failed", { error: (cleanupErr as Error).message })
		}
	}

	process.exit(exitCode)
}

main()
