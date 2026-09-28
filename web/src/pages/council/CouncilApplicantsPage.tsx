import { EmptyState } from "@/components/EmptyState"
import { ApplicantCard } from "@/components/council/ApplicantCard"
import { Switch } from "@/components/council/Switch"
import { PageHead } from "@/components/council/headings"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { useCouncilApplicants, useCouncilMembers, useCouncilRole } from "@/hooks/useCouncilData"
import { useApplicantDecision, useApplicantOpinion } from "@/hooks/useCouncilMutations"
import type { CouncilPerson } from "@/lib/council-types"
import { IconSchool } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

export function CouncilApplicantsPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const [nearMisses, setNearMisses] = useState(false)
  const applicants = useCouncilApplicants(nearMisses).data
  const admin = useCouncilRole()?.admin ?? false
  const roster = useCouncilMembers().data?.find((m) => m.isYou)
  const me: CouncilPerson = roster ?? {
    userId: 0,
    keyId: meKeyId,
    displayName: "You",
    handle: null,
    avatarUrl: null,
    tier: null,
    badgeCount: 0,
    topBadge: null,
    featured: [],
  }
  const opinion = useApplicantOpinion(me)
  const decision = useApplicantDecision()
  const shown = applicants?.filter((a) => a.state === "pending_review" || (nearMisses && a.state === "failed"))

  return (
    <>
      <PageHead
        title="Applicants"
        sub="People who passed the entry exam. Give your opinion. Admins make the final call and butler grants the role."
        actions={
          <span className="text-xs text-unison-text-muted">
            <Switch checked={nearMisses} onChange={setNearMisses}>
              Show near misses
            </Switch>
          </span>
        }
      />
      {shown === undefined ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(440px,100%),1fr))] gap-5">
          {skeletonKeys("applicant", 2).map((key) => (
            <Bone key={key} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<IconSchool className="size-5" stroke={1.5} />}
          title="No applicants waiting"
          hint="New exam results show up here after an applicant submits."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(440px,100%),1fr))] gap-5">
          {shown.map((applicant) => (
            <ApplicantCard
              key={applicant.applicantId}
              applicant={applicant}
              now={now}
              admin={admin}
              busy={decision.isPending}
              onOpinion={(stance) => opinion.mutate({ applicant, stance })}
              onDecision={(d) => decision.mutate({ applicant, decision: d })}
            />
          ))}
        </div>
      )}
    </>
  )
}
