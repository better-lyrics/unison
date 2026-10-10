import { config } from "@/config"
import { type CouncilPerson, loadPersonDecor, toCouncilPerson } from "@/db/council-person"
import { type OpenFlag, listOpenFlags } from "@/db/flags"
import { resolvePeople } from "@/db/users"
import type { Env } from "@/types"

export interface CouncilFlagItem
	extends Omit<OpenFlag, "submitterId" | "reports" | "removerIds" | "keeperIds"> {
	submitter: CouncilPerson | null
	reports: {
		reason: string
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
	return { items, needed: config.council.flagRemovals }
}
