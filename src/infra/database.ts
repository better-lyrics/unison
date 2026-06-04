import pg from "pg"

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(databaseUrl: string): pg.Pool {
	if (!pool) {
		pool = new Pool({
			connectionString: databaseUrl,
			max: 30,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 5_000,
			allowExitOnIdle: true,
		})
		pool.on("error", (err) => {
			console.error("pg pool idle client error", err.message)
		})
	}
	return pool
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end()
		pool = null
	}
}

type Queryable = pg.Pool | pg.PoolClient

class PreparedStatement {
	readonly sql: string
	private params: unknown[] = []
	private queryable: Queryable

	constructor(queryable: Queryable, sql: string) {
		this.queryable = queryable
		let idx = 0
		this.sql = sql.replace(/\?/g, () => `$${++idx}`)
	}

	bind(...args: unknown[]): PreparedStatement {
		this.params = args
		return this
	}

	async first<T>(): Promise<T | null> {
		const result = await this.queryable.query(this.sql, this.params)
		return (result.rows[0] as T) ?? null
	}

	async all<T>(): Promise<{ results: T[] }> {
		const result = await this.queryable.query(this.sql, this.params)
		return { results: result.rows as T[] }
	}

	async run(): Promise<void> {
		await this.queryable.query(this.sql, this.params)
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
	private client: pg.PoolClient | null

	constructor(pool: pg.Pool, client: pg.PoolClient | null = null) {
		this.pool = pool
		this.client = client
	}

	private get queryable(): Queryable {
		return this.client ?? this.pool
	}

	prepare(sql: string): PreparedStatement {
		return new PreparedStatement(this.queryable, sql)
	}

	async batch(statements: PreparedStatement[]): Promise<void> {
		if (this.client) {
			for (const stmt of statements) {
				await this.client.query(stmt.getSql(), stmt.getParams())
			}
			return
		}
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

	async transaction<T>(fn: (tx: D1Compat) => Promise<T>): Promise<T> {
		if (this.client) {
			return fn(this)
		}
		const client = await this.pool.connect()
		try {
			await client.query("BEGIN")
			const tx = new D1Compat(this.pool, client)
			const result = await fn(tx)
			await client.query("COMMIT")
			return result
		} catch (err) {
			await client.query("ROLLBACK")
			throw err
		} finally {
			client.release()
		}
	}
}
