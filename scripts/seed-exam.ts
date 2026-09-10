#!/usr/bin/env tsx
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"
import { type ExamQuestionInput, upsertQuestions } from "@/db/exam"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"

// Seeds the private Council exam bank into the database. The bank content lives
// only in a local, gitignored JSON file (default scripts/local/exam-bank.json) or
// a path passed as the first argument. Nothing about question content, choices,
// answer keys, or weights is committed. Rows are upserted by id and retired with
// active:false, so re-running edits in place and never breaks live sessions.
//
// Usage: pnpm run exam:seed [path-to-bank.json]

const TYPES = new Set(["timing", "mcq", "scenario"])

function parseBank(raw: string): ExamQuestionInput[] {
	const parsed = JSON.parse(raw) as unknown
	const list = Array.isArray(parsed)
		? parsed
		: (parsed as { questions?: unknown }).questions
	if (!Array.isArray(list)) {
		throw new Error("bank must be an array of questions or { questions: [...] }")
	}
	return list.map((entry, i) => {
		const q = entry as Partial<ExamQuestionInput>
		if (typeof q.id !== "number") throw new Error(`question[${i}]: missing numeric id`)
		if (typeof q.type !== "string" || !TYPES.has(q.type))
			throw new Error(`question[${i}]: type must be one of ${[...TYPES].join(", ")}`)
		if (typeof q.category !== "string" || q.category.length === 0)
			throw new Error(`question[${i}]: missing category`)
		if (typeof q.prompt !== "string") throw new Error(`question[${i}]: missing prompt`)
		if (typeof q.weight !== "number") throw new Error(`question[${i}]: missing numeric weight`)
		if (!q.answerKey || !Array.isArray(q.answerKey.parts))
			throw new Error(`question[${i}]: answerKey.parts must be an array`)
		return q as ExamQuestionInput
	})
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		console.error("DATABASE_URL is required")
		process.exit(1)
	}

	const bankPath = resolve(process.argv[2] ?? "scripts/local/exam-bank.json")
	let questions: ExamQuestionInput[]
	try {
		questions = parseBank(readFileSync(bankPath, "utf-8"))
	} catch (err) {
		console.error(`failed to read bank at ${bankPath}: ${(err as Error).message}`)
		process.exit(1)
	}

	const pool = new pg.Pool({ connectionString: databaseUrl })
	const env = { DB: new D1Compat(pool) } as unknown as Env
	try {
		const count = await upsertQuestions(env, questions)
		const active = questions.filter((q) => q.active !== false).length
		console.log(`seeded ${count} questions from ${bankPath} (${active} active)`)
	} catch (err) {
		console.error(`seed failed: ${(err as Error).message}`)
		process.exitCode = 1
	} finally {
		await pool.end()
	}
}

main()
