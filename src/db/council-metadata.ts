import { config } from "@/config"
import { type CouncilPerson, loadPersonDecor, toCouncilPerson } from "@/db/council-person"
import { type OpenProposal, listOpenProposals } from "@/db/metadata-proposals"
import { resolvePeople } from "@/db/users"
import type { Env } from "@/types"

export interface MetadataItem extends Omit<OpenProposal, "proposerId" | "approverIds"> {
	song: string
	artist: string
	proposer: CouncilPerson | null
	approvers: CouncilPerson[]
}

export async function listCouncilMetadata(
	env: Env
): Promise<{ items: MetadataItem[]; needed: number }> {
	const proposals = await listOpenProposals(env)
	const people = await resolvePeople(env, [
		...new Set(proposals.flatMap((p) => [p.proposerId, ...p.approverIds])),
	])
	const decor = await loadPersonDecor(env, [...people.values()])
	const person = (id: number) => {
		const found = people.get(id)
		return found ? toCouncilPerson(found, decor) : null
	}
	const items = proposals.map(({ proposerId, approverIds, ...proposal }) => ({
		...proposal,
		song: proposal.before.song,
		artist: proposal.before.artist,
		proposer: person(proposerId),
		approvers: approverIds.flatMap((id) => person(id) ?? []),
	}))
	return { items, needed: config.council.metadataApprovals }
}
