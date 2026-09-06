import { useCallback } from "react"
import { useParams } from "react-router-dom"
import { useOptionalSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { OwnerControls } from "@/components/OwnerControls"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { UserProfileView } from "@/components/UserProfileView"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserByHandle } from "@/lib/api"
import { toHandle } from "@/lib/handle"

// Resolves a /u/<handle> share URL to a curator via the authoritative handle lookup.
export function NicknamePage() {
  const { nickname } = useParams<{ nickname: string }>()
  const handle = nickname ? toHandle(nickname) : ""
  const resolver = useCallback(() => fetchUserByHandle(nickname ?? ""), [nickname])
  const resolved = useAsyncData(resolver, `handle:${handle}`)
  const session = useOptionalSession()

  if (!nickname) return <EmptyState title="No curator specified" />
  if (resolved.status === "loading") return <ProfileSkeleton />
  if (resolved.status === "error") {
    return <EmptyState title="No curator found" hint={`No curator matches @${handle}.`} />
  }

  const keyId = resolved.data.keyId
  const isOwner = session?.status === "signed-in" && session.identity.keyId === keyId

  return (
    <div className="space-y-6">
      <UserProfileView keyId={keyId} />
      {isOwner ? <OwnerControls /> : null}
    </div>
  )
}
