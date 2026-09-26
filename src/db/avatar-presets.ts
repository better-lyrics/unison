import { config } from "@/config"
import type { Env } from "@/types"

export interface AvatarPreset {
	id: string
	label: string
	file: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
	{ id: "alien-cat", label: "Alien Cat", file: "alien-cat.webp" },
	{ id: "angry-cat", label: "Angry Cat", file: "angry-cat.webp" },
	{ id: "angry-kitten", label: "Angry Kitten", file: "angry-kitten.webp" },
	{ id: "anthropomorph", label: "Anthropomorph", file: "anthropomorph.webp" },
	{ id: "ape-animal", label: "Ape Animal", file: "ape-animal.webp" },
	{ id: "bee-cat", label: "Bee Cat", file: "bee-cat.webp" },
	{ id: "blurry-kitten", label: "Blurry Kitten", file: "blurry-kitten.webp" },
	{ id: "bow-kitten-5", label: "Bow Kitten 5", file: "bow-kitten-5.webp" },
	{ id: "cat-hi", label: "Cat Hi", file: "cat-hi.webp" },
	{ id: "cat-mugshot", label: "Cat Mugshot", file: "cat-mugshot.webp" },
	{ id: "cool-chicken", label: "Cool Chicken", file: "cool-chicken.webp" },
	{ id: "cool-monkey", label: "Cool Monkey", file: "cool-monkey.webp" },
	{ id: "cute-cat-dood", label: "Cute Cat Dood", file: "cute-cat-dood.webp" },
	{ id: "da-lion-car", label: "Da Lion Car", file: "da-lion-car.webp" },
	{ id: "distorted-guy", label: "Distorted Guy", file: "distorted-guy.webp" },
	{ id: "edited-cat", label: "Edited Cat", file: "edited-cat.webp" },
	{ id: "el-gato", label: "El Gato", file: "el-gato.webp" },
	{ id: "end-cat", label: "End Cat", file: "end-cat.webp" },
	{ id: "face-paint", label: "Face Paint", file: "face-paint.webp" },
	{ id: "five-nights", label: "Five Nights", file: "five-nights.webp" },
	{ id: "flower-dog", label: "Flower Dog", file: "flower-dog.webp" },
	{ id: "flowers-white", label: "Flowers White", file: "flowers-white.webp" },
	{ id: "gamer-cat", label: "Gamer Cat", file: "gamer-cat.webp" },
	{ id: "glasses-teen", label: "Glasses Teen", file: "glasses-teen.webp" },
	{ id: "lebron-selfie", label: "Lebron Selfie", file: "lebron-selfie.webp" },
	{ id: "melon-dog", label: "Melon Dog", file: "melon-dog.webp" },
	{ id: "meme-face", label: "Meme Face", file: "meme-face.webp" },
	{ id: "oia-uia-cat", label: "Oia Uia Cat", file: "oia-uia-cat.webp" },
	{ id: "pale-frog", label: "Pale Frog", file: "pale-frog.webp" },
	{ id: "pink-hood-toy", label: "Pink Hood Toy", file: "pink-hood-toy.webp" },
	{ id: "rich-daffy", label: "Rich Daffy", file: "rich-daffy.webp" },
	{ id: "sad-shrek", label: "Sad Shrek", file: "sad-shrek.webp" },
	{ id: "silly-tabby", label: "Silly Tabby", file: "silly-tabby.webp" },
	{ id: "smirking-cat", label: "Smirking Cat", file: "smirking-cat.webp" },
	{ id: "tie-cat", label: "Tie Cat", file: "tie-cat.webp" },
	{ id: "tongue-cat-2", label: "Tongue Cat 2", file: "tongue-cat-2.webp" },
	{ id: "tongue-cat", label: "Tongue Cat", file: "tongue-cat.webp" },
	{ id: "uwu-mustache", label: "Uwu Mustache", file: "uwu-mustache.webp" },
	{ id: "winking-dog", label: "Winking Dog", file: "winking-dog.webp" },
	{ id: "witch-cat", label: "Witch Cat", file: "witch-cat.webp" },
	{ id: "yawning-tabby", label: "Yawning Tabby", file: "yawning-tabby.webp" },
]

const BUILT_IN_IDS = new Set(AVATAR_PRESETS.map((p) => p.id))

let catalogue: AvatarPreset[] = [...AVATAR_PRESETS]
let lastRefreshStarted = 0
let lastRefreshApplied = 0

export function getPresets(): AvatarPreset[] {
	return catalogue
}

export function findPreset(id: string): AvatarPreset | undefined {
	return catalogue.find((p) => p.id === id)
}

export async function refreshCatalogue(env: Env): Promise<void> {
	const ticket = ++lastRefreshStarted
	const published = await listPublishedPresets(env)
	if (ticket < lastRefreshApplied) return
	lastRefreshApplied = ticket
	catalogue = [...AVATAR_PRESETS, ...published.filter((p) => !BUILT_IN_IDS.has(p.id))]
}

interface PresetRow {
	id: string
	label: string
	file: string
	createdBy?: string | null
}

export async function insertPreset(
	env: Env,
	preset: PresetRow,
	now: number = Date.now()
): Promise<"inserted" | "exists"> {
	const { results } = await env.DB.prepare(
		`INSERT INTO avatar_presets (id, label, file, created_by, created_at, published_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO NOTHING
		 RETURNING id`
	)
		.bind(preset.id, preset.label, preset.file, preset.createdBy ?? null, now, now)
		.all<{ id: string }>()
	return results.length > 0 ? "inserted" : "exists"
}

export async function reservePreset(
	env: Env,
	preset: PresetRow,
	now: number = Date.now()
): Promise<"reserved" | "exists"> {
	const { results } = await env.DB.prepare(
		`INSERT INTO avatar_presets (id, label, file, created_by, created_at, published_at)
		 VALUES (?, ?, ?, ?, ?, NULL)
		 ON CONFLICT (id) DO UPDATE SET
		   label = EXCLUDED.label, file = EXCLUDED.file,
		   created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at
		 WHERE avatar_presets.published_at IS NULL AND avatar_presets.created_at < ?
		 RETURNING id`
	)
		.bind(
			preset.id,
			preset.label,
			preset.file,
			preset.createdBy ?? null,
			now,
			now - config.avatar.reservationTtlMs
		)
		.all<{ id: string }>()
	return results.length > 0 ? "reserved" : "exists"
}

export async function publishPreset(env: Env, id: string, now: number = Date.now()): Promise<void> {
	await env.DB.prepare("UPDATE avatar_presets SET published_at = ? WHERE id = ?")
		.bind(now, id)
		.run()
}

export async function deletePreset(env: Env, id: string): Promise<void> {
	await env.DB.prepare("DELETE FROM avatar_presets WHERE id = ?").bind(id).run()
}

export async function listPublishedPresets(env: Env): Promise<AvatarPreset[]> {
	const { results } = await env.DB.prepare(
		"SELECT id, label, file FROM avatar_presets WHERE published_at IS NOT NULL ORDER BY id"
	).all<AvatarPreset>()
	return results
}
