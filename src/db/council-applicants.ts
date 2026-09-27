import { config } from "@/config"
import { type OpinionStance, listOpinions } from "@/db/applicant-opinions"
import { type CouncilPerson, withTier } from "@/db/council-person"
import { type Applicant, listApplicants } from "@/db/exam"
import { getCuratorTierMap } from "@/db/leaderboard"
import { resolvePeople, resolvePeopleByKeyIds } from "@/db/users"
import type { Env } from "@/types"
import { retakeAvailableAt } from "@/utils/exam-retake"

export interface ApplicantNote {
	by: CouncilPerson
	stance: OpinionStance
	note: string
}

export interface ApplicantView extends Omit<Applicant, "decidedByDiscordId"> {
	person: CouncilPerson | null
	retakeAt: number | null
	opinions: {
		support: CouncilPerson[]
		object: CouncilPerson[]
		notes: ApplicantNote[]
		mine: OpinionStance | null
	}
}

export async function listCouncilApplicants(
	env: Env,
	opts: { meId: number; includeBelowCutoff: boolean }
): Promise<ApplicantView[]> {
	const applicants = await listApplicants(env, opts.includeBelowCutoff)
	if (applicants.length === 0) return []
	const [opinions, tiers, applicantPeople] = await Promise.all([
		listOpinions(
			env,
			applicants.map((a) => a.applicantId)
		),
		getCuratorTierMap(env),
		resolvePeopleByKeyIds(
			env,
			applicants.map((a) => a.keyId)
		),
	])
	const voters = await resolvePeople(
		env,
		[...opinions.values()].flat().map((o) => o.userId)
	)
	const voter = (userId: number) => {
		const person = voters.get(userId)
		return person ? withTier(person, tiers) : null
	}

	return applicants.map(({ decidedByDiscordId: _decider, ...a }) => {
		const list = opinions.get(a.applicantId) ?? []
		const stance = (s: OpinionStance) =>
			list.flatMap((o) => (o.stance === s ? [voter(o.userId)] : [])).filter((p) => p !== null)
		const person = applicantPeople.get(a.keyId)
		return {
			...a,
			person: person ? withTier(person, tiers) : null,
			retakeAt: retakeAvailableAt(a, config.exam.retakeCooldownSec),
			opinions: {
				support: stance("support"),
				object: stance("object"),
				notes: list.flatMap((o) => {
					const by = voter(o.userId)
					return by && o.note ? [{ by, stance: o.stance, note: o.note }] : []
				}),
				mine: list.find((o) => o.userId === opts.meId)?.stance ?? null,
			},
		}
	})
}
