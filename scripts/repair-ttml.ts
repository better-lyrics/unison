import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	type ManifestEntry,
	type RepairAction,
	applyTtmlRepairs,
	planTtmlRepairs,
	revertTtmlRepairs,
} from "@/db/ttml-repair"
import { closeRedis } from "@/infra/cache"
import { closePool } from "@/infra/database"
import { createEnv } from "@/infra/env"

const USAGE = `usage:
  pnpm ttml:repair [--out plan.json]      dry run, writes the plan
  pnpm ttml:repair --apply plan.json      applies that plan, writes plan.manifest.jsonl
  pnpm ttml:repair --revert manifest.jsonl`

const CONTEXT = 40

function excerpt(text: string): string {
	const flat = JSON.stringify(text).slice(1, -1)
	return flat.length > 160 ? `${flat.slice(0, 80)}…${flat.slice(-80)}` : flat
}

function describeChange(before: string, after: string): string[] {
	const kept = before.indexOf(after)
	if (kept >= 0) {
		const head = before.slice(0, kept)
		const tail = before.slice(kept + after.length)
		return [
			head && `    - head [${excerpt(head)}] before ${excerpt(after.slice(0, CONTEXT))}…`,
			tail && `    - tail …${excerpt(after.slice(-CONTEXT))} then [${excerpt(tail)}]`,
		].filter(Boolean)
	}
	let prefix = 0
	while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) {
		prefix++
	}
	let suffix = 0
	while (
		suffix < Math.min(before.length, after.length) - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix++
	}
	const context = excerpt(before.slice(Math.max(0, prefix - CONTEXT), prefix))
	return [
		`    - …${context}[${excerpt(before.slice(prefix, before.length - suffix))}]`,
		`    + …${context}[${excerpt(after.slice(prefix, after.length - suffix))}]`,
	]
}

function printPlan(actions: RepairAction[]): void {
	for (const action of actions) {
		if (action.kind === "repair") {
			console.log(`repair ${action.lyricsId}`)
			for (const line of describeChange(action.before, action.after)) console.log(line)
		} else if (action.kind === "delete") {
			console.log(`delete ${action.lyricsId}: ${action.problem}`)
		} else {
			console.log(`skip   ${action.lyricsId}: ${action.reason}`)
		}
	}
	const count = (kind: RepairAction["kind"]) => actions.filter((a) => a.kind === kind).length
	console.log(
		`\n${count("repair")} repair, ${count("delete")} delete, ${count("skip")} skip (no rows written)`
	)
}

function readManifest(path: string): ManifestEntry[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as ManifestEntry)
}

async function main() {
	const [, , mode, path] = process.argv
	const known = mode === undefined || (["--out", "--apply", "--revert"].includes(mode) && path)
	if (!known) {
		console.error(USAGE)
		process.exitCode = 1
		return
	}
	const env = createEnv()
	try {
		if (mode === "--apply" && path) {
			const actions = JSON.parse(readFileSync(path, "utf8")) as RepairAction[]
			const manifestPath = path.replace(/\.json$/, "") + ".manifest.jsonl"
			writeFileSync(manifestPath, "", { flag: "wx" })
			const manifest = await applyTtmlRepairs(env, actions, (entry) => {
				appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`)
				console.log(`${entry.kind} ${entry.lyricsId}`)
			})
			console.log(`\napplied ${manifest.length} of ${actions.length}; manifest: ${manifestPath}`)
		} else if (mode === "--revert" && path) {
			const result = await revertTtmlRepairs(env, readManifest(path))
			console.log(`reverted ${result.reverted}; skipped ${result.skipped.join(", ") || "none"}`)
		} else {
			const out =
				mode === "--out" && path ? path : join(tmpdir(), `ttml-repair-plan-${Date.now()}.json`)
			const actions = await planTtmlRepairs(env)
			printPlan(actions)
			writeFileSync(out, JSON.stringify(actions, null, 1))
			console.log(`plan: ${out}`)
		}
	} finally {
		await closePool()
		await closeRedis()
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
