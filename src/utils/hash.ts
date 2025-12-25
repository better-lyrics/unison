export function hashIP(ip: string): string {
	let hash = 0
	for (let i = 0; i < ip.length; i++) {
		const char = ip.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash
	}
	return Math.abs(hash).toString(36)
}

export function hashDeviceId(deviceId: string): string {
	// Use a stronger hash for device IDs (FNV-1a inspired)
	let hash = 2166136261
	for (let i = 0; i < deviceId.length; i++) {
		hash ^= deviceId.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}
