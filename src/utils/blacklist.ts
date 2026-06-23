import { config } from "@/config"

export function isLinkBlacklisted(keyId: string): boolean {
	if (!keyId) return false
	return config.linking.blacklistedKeyIds.has(keyId.toLowerCase())
}
