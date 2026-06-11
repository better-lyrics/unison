import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity"

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
})

export function isProfane(name: string): boolean {
	return matcher.hasMatch(name)
}
