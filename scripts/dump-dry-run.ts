#!/usr/bin/env tsx
import { tmpdir } from "node:os"
import { join } from "node:path"
import pg from "pg"
import { D1Compat } from "@/infra/database"
import { Logger } from "@/infra/logger"
import { buildManifest, materializeDumpSchema, runPgDump, verifyDump } from "@/jobs/dump"
import type { Env } from "@/types"

const log = new Logger("dump:dry-run")

async function main() {
	const dumpDatabaseUrl = process.env.DUMP_DATABASE_URL || process.env.DATABASE_URL
	if (!dumpDatabaseUrl) {
		log.error("DATABASE_URL is required (or DUMP_DATABASE_URL for the restricted role)")
		process.exit(1)
	}

	const pool = new pg.Pool({ connectionString: dumpDatabaseUrl })
	pool.on("error", (err) => {
		log.error("dry-run pool emitted error", { error: err.message })
	})
	const env = {
		DB: new D1Compat(pool),
		DUMP_PUBLIC_BASE_URL: process.env.DUMP_PUBLIC_BASE_URL || "https://dumps.unison.example",
	} as unknown as Env

	const dateStr = new Date().toISOString().slice(0, 10)
	const localPath = join(tmpdir(), `unison-${dateStr}-dryrun.dump`)
	const datedKey = `dumps/unison-${dateStr}.dump`

	log.info("Unison dump dry run", {
		localPath,
		usingDumpRole: !!process.env.DUMP_DATABASE_URL,
	})

	let exitCode = 0
	let materialized = false
	try {
		log.info("materializing public_dump schema")
		await materializeDumpSchema(env)
		materialized = true

		log.info("running pg_dump")
		await runPgDump({ databaseUrl: dumpDatabaseUrl, outPath: localPath })

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
			publicBaseUrl: env.DUMP_PUBLIC_BASE_URL,
		})
		log.info("manifest ready", manifest as unknown as Record<string, unknown>)

		console.log("\nmanifest preview:")
		console.log(JSON.stringify(manifest, null, 2))

		log.info("dry run complete. Artifact retained for inspection", { localPath })
	} catch (err) {
		log.error("dry run failed", { error: (err as Error).message })
		exitCode = 1
	} finally {
		if (materialized) {
			try {
				await env.DB.prepare("DROP SCHEMA IF EXISTS public_dump CASCADE").run()
			} catch (cleanupErr) {
				log.warn("schema cleanup failed", { error: (cleanupErr as Error).message })
			}
		}
		try {
			await pool.end()
		} catch (cleanupErr) {
			log.warn("pool cleanup failed", { error: (cleanupErr as Error).message })
		}
	}

	process.exit(exitCode)
}

main()
