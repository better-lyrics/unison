export interface AvatarPreset {
	id: string
	label: string
	file: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
	{ id: "note-violet", label: "Violet Note", file: "note-violet.png" },
	{ id: "note-amber", label: "Amber Note", file: "note-amber.png" },
	{ id: "note-teal", label: "Teal Note", file: "note-teal.png" },
]

export function findPreset(id: string): AvatarPreset | undefined {
	return AVATAR_PRESETS.find((p) => p.id === id)
}
