import pg from "pg"

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(databaseUrl: string): pg.Pool {
	if (!pool) {
		pool = new Pool({ connectionString: databaseUrl })
	}
	return pool
}

class PreparedStatement {
	readonly sql: string
	private params: unknown[] = []
	private pool: pg.Pool

	constructor(pool: pg.Pool, sql: string) {
		this.pool = pool
		// Convert ? placeholders to $1, $2, ... for PostgreSQL
		let idx = 0
		this.sql = sql.replace(/\?/g, () => `$${++idx}`)
	}

	bind(...args: unknown[]): PreparedStatement {
		this.params = args
		return this
	}

	async first<T>(): Promise<T | null> {
		const result = await this.pool.query(this.sql, this.params)
		return (result.rows[0] as T) ?? null
	}

	async all<T>(): Promise<{ results: T[] }> {
		const result = await this.pool.query(this.sql, this.params)
		return { results: result.rows as T[] }
	}

	async run(): Promise<void> {
		await this.pool.query(this.sql, this.params)
	}

	getSql(): string {
		return this.sql
	}

	getParams(): unknown[] {
		return this.params
	}
}

export class D1Compat {
	private pool: pg.Pool

	constructor(pool: pg.Pool) {
		this.pool = pool
	}

	prepare(sql: string): PreparedStatement {
		return new PreparedStatement(this.pool, sql)
	}

	async batch(statements: PreparedStatement[]): Promise<void> {
		const client = await this.pool.connect()
		try {
			await client.query("BEGIN")
			for (const stmt of statements) {
				await client.query(stmt.getSql(), stmt.getParams())
			}
			await client.query("COMMIT")
		} catch (err) {
			await client.query("ROLLBACK")
			throw err
		} finally {
			client.release()
		}
	}
}
