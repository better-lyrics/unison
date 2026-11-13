export interface ShowcaseEntry {
	name: string
	description: string
	url: string
	icon?: string
	iconFillsTile?: boolean
	featured?: boolean
	platforms: string[]
}

export interface ShowcaseSubmission {
	name: string
	url: string
	description: string
	platforms: string[]
	iconUrl: string
	screenshotUrls: string[]
}

export type ParseResult = { ok: true; value: ShowcaseSubmission } | { ok: false; errors: string[] }

const ATTACHMENT_URL =
	/https:\/\/(?:github\.com\/user-attachments\/assets\/[0-9a-f-]{36}|user-images\.githubusercontent\.com\/\d+\/[\w.-]+)/gi

const PLAIN_LABEL = /^[\p{L}\p{N} .+'&!()-]+$/u
const MARKDOWN_SYNTAX = /[\\`*_[\]<>!|~#]/g

const README_START = "<!-- showcase:start -->"
const README_END = "<!-- showcase:end -->"

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : ""
}

function attachments(value: unknown): string[] {
	return [...new Set(text(value).match(ATTACHMENT_URL) ?? [])]
}

function isHttpsUrl(value: string): boolean {
	if (/[\s()<>]/.test(value)) return false
	try {
		const url = new URL(value)
		return url.protocol === "https:" && url.hostname.includes(".")
	} catch {
		return false
	}
}

export function parseSubmission(form: Record<string, unknown>): ParseResult {
	const errors: string[] = []

	const name = text(form.name)
	if (name.length < 1 || name.length > 40 || !PLAIN_LABEL.test(name)) {
		errors.push(
			"The app name must be 1 to 40 characters of letters, numbers, spaces and `. + - ' & ! ( )`."
		)
	}

	const url = text(form.url)
	if (!isHttpsUrl(url)) errors.push("The link must be a full `https://` address.")

	const description = text(form.description)
	if (description.length < 10 || description.length > 140 || /[\r\n]/.test(description)) {
		errors.push("The description must be 10 to 140 characters on one line.")
	}

	const platforms = text(form.platforms)
		.split(",")
		.map((platform) => platform.trim())
		.filter(Boolean)
	if (
		platforms.length < 1 ||
		platforms.length > 6 ||
		platforms.some((p) => p.length > 24 || !PLAIN_LABEL.test(p))
	) {
		errors.push(
			"List 1 to 6 platforms separated by commas. Each one must be under 25 characters of letters, numbers, spaces and `. + - ' & ! ( )`."
		)
	}

	const [iconUrl] = attachments(form.icon)
	if (!iconUrl) errors.push("Drag your icon image into the Icon field so GitHub uploads it.")

	const screenshotUrls = attachments(form.attribution)
	if (screenshotUrls.length === 0) {
		errors.push("Drag at least one screenshot of the credit into the Attribution field.")
	}

	const license = Array.isArray(form.license) ? form.license : []
	if (license.length === 0) errors.push("Tick the license box.")

	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, value: { name, url, description, platforms, iconUrl, screenshotUrls } }
}

function sameUrl(a: string, b: string): boolean {
	const normal = (value: string) => new URL(value).href.replace(/\/+$/, "")
	return normal(a) === normal(b)
}

export function findDuplicate(
	apps: ShowcaseEntry[],
	candidate: Pick<ShowcaseEntry, "name" | "url">
): "name" | "url" | null {
	if (
		apps.some((app) => app.name.localeCompare(candidate.name, "en", { sensitivity: "base" }) === 0)
	)
		return "name"
	if (apps.some((app) => sameUrl(app.url, candidate.url))) return "url"
	return null
}

export function compareShowcaseNames(a: ShowcaseEntry, b: ShowcaseEntry): number {
	return a.name.localeCompare(b.name, "en", { sensitivity: "base" })
}

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "app"
	)
}

export function readmeShowcaseSection(apps: ShowcaseEntry[]): string {
	const lines = apps.map(
		(app) => `- [${app.name}](${app.url}): ${app.description.replace(MARKDOWN_SYNTAX, "\\$&")}`
	)
	return [README_START, ...lines, README_END].join("\n")
}

export function replaceReadmeShowcase(readme: string, apps: ShowcaseEntry[]): string {
	const start = readme.indexOf(README_START)
	const end = readme.indexOf(README_END)
	if (start === -1 || end < start) throw new Error("README is missing the showcase markers")
	return (
		readme.slice(0, start) + readmeShowcaseSection(apps) + readme.slice(end + README_END.length)
	)
}
