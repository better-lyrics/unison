export function hashIP(ip: string): string {
	let hash = 0
	for (let i = 0; i < ip.length; i++) {
		const char = ip.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash
	}
	return Math.abs(hash).toString(36)
}
