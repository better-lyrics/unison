import { useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { UserProfileView } from "@/components/UserProfileView"

export function UserPage() {
  const { keyId } = useParams<{ keyId: string }>()
  if (!keyId) return <EmptyState title="No user specified" />
  return <UserProfileView keyId={keyId} />
}
