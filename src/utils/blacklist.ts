import { config } from "@/config"

export const COMMUNITY_KEY_ID = "cea10b57de8e060ed1a180a00c2bc717a2ab4f231d88fd33ffa6a50a04f23b6e"

export function isLinkBlacklisted(keyId: string): boolean {
	if (!keyId) return false
	return config.linking.blacklistedKeyIds.has(keyId.toLowerCase())
}

export function listBlacklistedKeyIds(): string[] {
	return [...config.linking.blacklistedKeyIds]
}
