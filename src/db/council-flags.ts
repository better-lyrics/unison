import { config } from "@/config"
import { type CouncilPerson, loadPersonDecor, toCouncilPerson } from "@/db/council-person"
import { type FlagReason, type OpenFlag, listOpenFlags, listRecentFlags } from "@/db/flags"
import { resolvePeople } from "@/db/users"
import type { Env } from "@/types"

export interface CouncilFlagItem
	extends Omit<OpenFlag, "submitterId" | "reports" | "removerIds" | "keeperIds"> {
	submitter: CouncilPerson | null
	reports: {
		reason: FlagReason
		details: string | null
		reporter: CouncilPerson | null
		createdAt: number
	}[]
	removers: CouncilPerson[]
	keepers: CouncilPerson[]
}

export async function listCouncilFlags(
	env: Env
): Promise<{ items: CouncilFlagItem[]; needed: number }> {
	const flags = await listOpenFlags(env)
	const people = await resolvePeople(env, [
		...new Set(
			flags.flatMap((f) => [
				...(f.submitterId === null ? [] : [f.submitterId]),
				...f.reports.map((r) => r.reporterId),
				...f.removerIds,
				...f.keeperIds,
			])
		),
	])
	const decor = await loadPersonDecor(env, [...people.values()])
	const person = (id: number | null) => {
		const found = id === null ? undefined : people.get(id)
		return found ? toCouncilPerson(found, decor) : null
	}
	const items = flags.map(({ submitterId, reports, removerIds, keeperIds, ...flag }) => ({
		...flag,
		submitter: person(submitterId),
		reports: reports.map(({ reporterId, ...report }) => ({
			...report,
			reporter: person(reporterId),
		})),
		removers: removerIds.flatMap((id) => person(id) ?? []),
		keepers: keeperIds.flatMap((id) => person(id) ?? []),
	}))
	return { items, needed: config.council.reportFlags.removals }
}

export interface BotFlagCase {
	id: number
	lyricsId: number
	videoId: string
	song: string
	artist: string
	submitterName: string | null
	openedAt: number
	status: "open" | "removed" | "kept"
	decidedAt: number | null
	reports: { reason: FlagReason; details: string | null; createdAt: number }[]
	removals: number
	keeps: number
}

export async function listBotFlags(
	env: Env,
	sinceSec: number
): Promise<{ needed: number; cases: BotFlagCase[] }> {
	const flags = await listRecentFlags(env, sinceSec)
	const submitters = await resolvePeople(env, [
		...new Set(flags.flatMap((f) => (f.submitterId === null ? [] : [f.submitterId]))),
	])
	const cases = flags.map((f) => ({
		id: f.id,
		lyricsId: f.lyricsId,
		videoId: f.videoId,
		song: f.song,
		artist: f.artist,
		submitterName:
			f.submitterId === null ? null : (submitters.get(f.submitterId)?.displayName ?? null),
		openedAt: f.openedAt,
		status: f.status,
		decidedAt: f.decidedAt,
		reports: f.reports.map(({ reason, details, createdAt }) => ({ reason, details, createdAt })),
		removals: f.removerIds.length,
		keeps: f.keeperIds.length,
	}))
	return { needed: config.council.reportFlags.removals, cases }
}
