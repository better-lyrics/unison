export interface CreditPart {
	text: string
	strong: boolean
}

const name = (text: string): CreditPart => ({ text, strong: true })
const plain = (text: string): CreditPart => ({ text, strong: false })

export function creditLine(names: string[], shown = 2): CreditPart[] {
	if (names.length === 1) return [name(names[0])]
	if (names.length === 2 && shown >= 2) return [name(names[0]), plain(" and "), name(names[1])]
	const named = names.slice(0, shown)
	const parts = named.flatMap((n, i) => (i === 0 ? [name(n)] : [plain(", "), name(n)]))
	return [...parts, plain(` and ${names.length - named.length} more`)]
}
