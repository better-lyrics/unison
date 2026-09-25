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
	{ id: "cat-mugshot", label: "Cat Mugshot", file: "cat-mugshot.webp" },
	{ id: "cool-chicken", label: "Cool Chicken", file: "cool-chicken.webp" },
	{ id: "cool-monkey", label: "Cool Monkey", file: "cool-monkey.webp" },
	{ id: "cute-cat-dood", label: "Cute Cat Dood", file: "cute-cat-dood.webp" },
	{ id: "distorted-guy", label: "Distorted Guy", file: "distorted-guy.webp" },
	{ id: "edited-cat", label: "Edited Cat", file: "edited-cat.webp" },
	{ id: "end-cat", label: "End Cat", file: "end-cat.webp" },
	{ id: "face-paint", label: "Face Paint", file: "face-paint.webp" },
	{ id: "five-nights", label: "Five Nights", file: "five-nights.webp" },
	{ id: "flower-dog", label: "Flower Dog", file: "flower-dog.webp" },
	{ id: "gamer-cat", label: "Gamer Cat", file: "gamer-cat.webp" },
	{ id: "glasses-teen", label: "Glasses Teen", file: "glasses-teen.webp" },
	{ id: "lebron-selfie", label: "Lebron Selfie", file: "lebron-selfie.webp" },
	{ id: "melon-dog", label: "Melon Dog", file: "melon-dog.webp" },
	{ id: "meme-face", label: "Meme Face", file: "meme-face.webp" },
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

export function findPreset(id: string): AvatarPreset | undefined {
	return AVATAR_PRESETS.find((p) => p.id === id)
}
