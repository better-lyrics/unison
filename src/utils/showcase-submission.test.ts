import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
	type ShowcaseEntry,
	compareShowcaseNames,
	findDuplicate,
	parseSubmission,
	readmeShowcaseSection,
} from "./showcase-submission"

const ICON_URL = "https://github.com/user-attachments/assets/3f6c1a2e-8b1d-4c9e-9f2a-6d0b7e5c4a11"
const SHOT_URL = "https://github.com/user-attachments/assets/9a7e2b44-1c3d-4f6a-8e5b-2d1c0f9e8b77"

const validForm = {
	name: "Lumen Player",
	url: "https://github.com/lumen-audio/lumen",
	description: "A lightweight desktop player with synced lyrics for local files.",
	platforms: "macOS, Windows,  Linux ",
	attribution: `Lyrics view with the credit row:\n\n<img width="1200" alt="credit" src="${SHOT_URL}" />`,
	icon: `![lumen-icon](${ICON_URL})`,
	license: [
		"My app fits the Unison Community License (a person, a non-profit or an open-source project)",
	],
}

describe("parseSubmission", () => {
	it("normalises a real form payload into a showcase entry", () => {
		const result = parseSubmission(validForm)
		expect(result).toEqual({
			ok: true,
			value: {
				name: "Lumen Player",
				url: "https://github.com/lumen-audio/lumen",
				description: "A lightweight desktop player with synced lyrics for local files.",
				platforms: ["macOS", "Windows", "Linux"],
				iconUrl: ICON_URL,
				screenshotUrls: [SHOT_URL],
			},
		})
	})

	it("refuses unsafe or incomplete input with one reason per field", () => {
		const result = parseSubmission({
			name: "Lumen](https://evil.example)",
			url: "http://lumen.example",
			description: "Short",
			platforms: "",
			attribution: "Trust me, it credits everyone.",
			icon: "![icon](https://evil.example/icon.png)",
			license: [],
		})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toHaveLength(7)
	})

	it("refuses a name that would ping people or link issues in the bot's PR", () => {
		const result = parseSubmission({ ...validForm, name: "@everyone #1" })
		expect(result.ok).toBe(false)
	})

	it("accepts every name already on the showcase", () => {
		const root = resolve(__dirname, "../..")
		const listed: ShowcaseEntry[] = JSON.parse(
			readFileSync(resolve(root, "web/src/lib/showcase.json"), "utf8")
		)
		for (const { name } of listed) {
			expect(parseSubmission({ ...validForm, name }).ok, name).toBe(true)
		}
	})
})

describe("readmeShowcaseSection", () => {
	it("escapes markdown in a description so the README shows it as text", () => {
		const section = readmeShowcaseSection([
			{
				name: "Lumen Player",
				url: "https://lumen.example",
				description: "![pixel](https://tracker.example/p.gif) *Synced* lyrics for local files.",
				platforms: ["macOS"],
			},
		])
		expect(section).toContain(
			"\\!\\[pixel\\](https://tracker.example/p.gif) \\*Synced\\* lyrics for local files."
		)
	})
})

describe("findDuplicate", () => {
	const listed: ShowcaseEntry[] = [
		{
			name: "Chora",
			description: "x",
			url: "https://github.com/CraftWorksMC/Chora",
			platforms: ["Android"],
		},
	]

	it("matches an app already listed by name or by link", () => {
		expect(findDuplicate(listed, { name: "chora", url: "https://chora.example" })).toBe("name")
		expect(
			findDuplicate(listed, { name: "Other", url: "https://GitHub.com/CraftWorksMC/Chora/" })
		).toBe("url")
		expect(findDuplicate(listed, { name: "Other", url: "https://other.example" })).toBeNull()
	})

	it("treats a link whose path differs only in case as a different app", () => {
		expect(
			findDuplicate(listed, { name: "Other", url: "https://github.com/craftworksmc/chora" })
		).toBeNull()
	})
})

describe("showcase data", () => {
	const root = resolve(__dirname, "../..")
	const apps: ShowcaseEntry[] = JSON.parse(
		readFileSync(resolve(root, "web/src/lib/showcase.json"), "utf8")
	)

	it("keeps the README list equal to showcase.json, sorted, with every icon on disk", () => {
		const readme = readFileSync(resolve(root, "README.md"), "utf8")
		expect(readme).toContain(readmeShowcaseSection(apps))
		expect([...apps].sort(compareShowcaseNames)).toEqual(apps)
		for (const app of apps) {
			if (app.icon)
				expect(existsSync(resolve(root, "web/public", `.${app.icon}`)), app.icon).toBe(true)
		}
	})
})
