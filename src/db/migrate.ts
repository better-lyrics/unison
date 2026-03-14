import fs from "node:fs"
import path from "node:path"
import pg from "pg"

const { Pool } = pg

async function migrate() {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		console.error("DATABASE_URL environment variable is required")
		process.exit(1)
	}

	const pool = new Pool({ connectionString: databaseUrl })

	const schemaPath = path.resolve(new URL(".", import.meta.url).pathname, "../../schema.sql")
	const schema = fs.readFileSync(schemaPath, "utf-8")

	try {
		await pool.query(schema)
		console.log("Migration completed successfully")
	} catch (err) {
		console.error("Migration failed:", err)
		process.exit(1)
	} finally {
		await pool.end()
	}
}

migrate()
