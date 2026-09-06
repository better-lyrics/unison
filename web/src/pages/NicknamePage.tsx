import { useCallback } from "react"
import { useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { UserProfileView } from "@/components/UserProfileView"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserByHandle } from "@/lib/api"
import { toHandle } from "@/lib/handle"

// Resolves a /u/<handle> share URL to a curator via the authoritative handle lookup.
// UserProfileView surfaces the owner's edit controls itself when the viewer owns the profile.
export function NicknamePage() {
  const { nickname } = useParams<{ nickname: string }>()
  const handle = nickname ? toHandle(nickname) : ""
  const resolver = useCallback(() => fetchUserByHandle(nickname ?? ""), [nickname])
  const resolved = useAsyncData(resolver, `handle:${handle}`)

  if (!nickname) return <EmptyState title="No curator specified" />
  if (resolved.status === "loading") return <ProfileSkeleton />
  if (resolved.status === "error") {
    return <EmptyState title="No curator found" hint={`No curator matches @${handle}.`} />
  }

  return <UserProfileView keyId={resolved.data.keyId} />
}
