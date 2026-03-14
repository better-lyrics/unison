import fs from "node:fs"
import path from "node:path"
import pg from "pg"
import { Logger } from "@/infra/logger"

const { Pool } = pg
const log = new Logger("db")

async function migrate() {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		log.error("DATABASE_URL environment variable is required")
		process.exit(1)
	}

	const pool = new Pool({ connectionString: databaseUrl })

	const schemaPath = path.resolve(new URL(".", import.meta.url).pathname, "../../schema.sql")
	const schema = fs.readFileSync(schemaPath, "utf-8")

	try {
		await pool.query(schema)
		log.info("migration completed successfully")
	} catch (err) {
		log.error("migration failed", { error: (err as Error).message })
		process.exit(1)
	} finally {
		await pool.end()
	}
}

migrate()
