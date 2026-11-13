import { createHash } from "node:crypto"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import {
	type ShowcaseEntry,
	type ShowcaseSubmission,
	compareShowcaseNames,
	findDuplicate,
	parseSubmission,
	replaceReadmeShowcase,
	slugify,
} from "@/utils/showcase-submission"
import sharp from "sharp"

const DATA_PATH = "web/src/lib/showcase.json"
const README_PATH = "README.md"
const ICON_DIR = "web/public/showcase"
const ICON_SIZE = 128
const MAX_ICON_BYTES = 5 * 1024 * 1024
const OPAQUE_ALPHA = 200

class SubmissionError extends Error {}

const UNREADABLE = "I couldn't read the icon as an image. Use a PNG or an SVG."
const SVG_TARGET_PX = 256

async function downloadIcon(url: string): Promise<Buffer> {
	const unreachable = () =>
		new SubmissionError("I couldn't download the icon. Try attaching it again.")
	const tooBig = new SubmissionError("The icon must be under 5 MB.")
	const response = await fetch(url, {
		redirect: "follow",
		signal: AbortSignal.timeout(15_000),
	}).catch(() => {
		throw unreachable()
	})
	if (!response.ok) throw unreachable()
	if (Number(response.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) throw tooBig
	const bytes = Buffer.from(
		await response.arrayBuffer().catch(() => {
			throw unreachable()
		})
	)
	if (bytes.length > MAX_ICON_BYTES) throw tooBig
	return bytes
}

async function renderIcon(bytes: Buffer): Promise<{ png: Buffer; fillsTile: boolean }> {
	const metadata = await sharp(bytes)
		.metadata()
		.catch(() => {
			throw new SubmissionError(UNREADABLE)
		})
	const { width = 0, height = 0, format } = metadata
	if (format !== "svg" && Math.min(width, height) < ICON_SIZE) {
		throw new SubmissionError(`The icon must be at least ${ICON_SIZE} by ${ICON_SIZE} pixels.`)
	}
	if (!width || !height || Math.abs(width - height) > Math.max(width, height) * 0.1) {
		throw new SubmissionError("The icon must be square.")
	}

	const density =
		format === "svg"
			? Math.min(2400, Math.max(1, (72 * SVG_TARGET_PX) / Math.max(width, height)))
			: 72
	try {
		const png = await sharp(bytes, { density })
			.resize(ICON_SIZE, ICON_SIZE, { fit: "cover" })
			.png()
			.toBuffer()
		const { data, info } = await sharp(png)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true })
		const inset = Math.round(ICON_SIZE * 0.12)
		const far = ICON_SIZE - 1 - inset
		const corners = [
			[inset, inset],
			[far, inset],
			[inset, far],
			[far, far],
		]
		const fillsTile = corners.every(
			([x, y]) => data[(y * info.width + x) * info.channels + 3] >= OPAQUE_ALPHA
		)
		return { png, fillsTile }
	} catch (error) {
		console.error(error)
		throw new SubmissionError(UNREADABLE)
	}
}

function prBody(
	submission: ShowcaseSubmission,
	entry: ShowcaseEntry,
	issue: string,
	author: string
): string {
	const screenshots = submission.screenshotUrls.map(
		(url) => `<img src="${url}" width="600" alt="Attribution">`
	)
	return [
		`Closes #${issue}`,
		"",
		`@${author} submitted **${entry.name}** through the showcase form.`,
		"",
		`- Link: ${entry.url}`,
		`- Platforms: ${entry.platforms.join(", ")}`,
		`- Icon fills its tile: ${entry.iconFillsTile ? "yes" : "no"} (a guess from the icon's corners; change \`iconFillsTile\` in this PR if it looks wrong)`,
		"",
		"### Attribution",
		"",
		...screenshots,
		"",
		"Merge to add it to the showcase, or close this PR to turn it down.",
	].join("\n")
}

function rejection(errors: string[], fixable: boolean): string {
	const next = fixable
		? "Edit the issue to fix these and I'll check it again."
		: "There's nothing to add, so I'm closing this. If you meant a different app, open a new submission."
	return [
		fixable ? "I couldn't add this yet:" : "I couldn't add this:",
		"",
		...errors.map((error) => `- ${error}`),
		"",
		next,
	].join("\n")
}

function setOutputs(outputs: Record<string, string>): void {
	const file = process.env.GITHUB_OUTPUT
	const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
	if (file) appendFileSync(file, `${lines.join("\n")}\n`)
	else console.log(lines.join("\n"))
}

async function main(): Promise<void> {
	const issue = process.env.ISSUE ?? ""
	const author = process.env.AUTHOR ?? ""
	const form = JSON.parse(process.env.SUBMISSION ?? "{}") as Record<string, unknown>
	const apps: ShowcaseEntry[] = JSON.parse(readFileSync(DATA_PATH, "utf8"))

	const parsed = parseSubmission(form)
	if (!parsed.ok) return reject(parsed.errors)
	const submission = parsed.value

	const duplicate = findDuplicate(apps, submission)
	if (duplicate) {
		const what =
			duplicate === "name" ? `An app named ${submission.name}` : `An app at ${submission.url}`
		return reject([`${what} is already on the showcase.`], false)
	}

	let icon: { png: Buffer; fillsTile: boolean }
	try {
		icon = await renderIcon(await downloadIcon(submission.iconUrl))
	} catch (error) {
		if (error instanceof SubmissionError) return reject([error.message])
		throw error
	}

	const hash = createHash("sha256").update(icon.png).digest("hex").slice(0, 8)
	const iconFile = `${slugify(submission.name)}-${hash}.png`
	writeFileSync(`${ICON_DIR}/${iconFile}`, icon.png)

	const entry: ShowcaseEntry = {
		name: submission.name,
		description: submission.description,
		url: submission.url,
		icon: `/showcase/${iconFile}`,
		...(icon.fillsTile ? { iconFillsTile: true } : {}),
		platforms: submission.platforms,
	}
	const next = [...apps, entry].sort(compareShowcaseNames)
	writeFileSync(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`)
	writeFileSync(README_PATH, replaceReadmeShowcase(readFileSync(README_PATH, "utf8"), next))
	writeFileSync("pr-body.md", prBody(submission, entry, issue, author))
	setOutputs({ valid: "true", name: entry.name })
}

function reject(errors: string[], fixable = true): void {
	writeFileSync("comment.md", rejection(errors, fixable))
	setOutputs({ valid: "false", fixable: String(fixable) })
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
