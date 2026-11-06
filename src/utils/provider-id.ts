export const PROVIDER_SERVICES = ["spotify", "apple_music", "tidal"] as const
export type ProviderService = (typeof PROVIDER_SERVICES)[number]
export type ProviderId = { service: ProviderService; id: string }

const FORMAT: Record<ProviderService, RegExp> = {
	spotify: /^[A-Za-z0-9]{22}$/,
	apple_music: /^\d{1,128}$/,
	tidal: /^\d{1,128}$/,
}

export const PROVIDER_ID_HINT =
	"Use a track id: 22 letters and digits for Spotify, digits only for Apple Music and Tidal."

export function isProviderService(value: unknown): value is ProviderService {
	return PROVIDER_SERVICES.some((service) => service === value)
}

/** Ids in priority order, or null when any given id is malformed. */
export function readProviderIds(
	query: Partial<Record<ProviderService, string>>
): ProviderId[] | null {
	const ids: ProviderId[] = []
	for (const service of PROVIDER_SERVICES) {
		const id = query[service]?.trim()
		if (!id) continue
		if (!FORMAT[service].test(id)) return null
		ids.push({ service, id })
	}
	return ids
}
