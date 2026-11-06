import { useCallback } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserSubmissions } from "@/lib/api"
import type { UserSubmission } from "@/lib/types"

export function useMySongs(keyId: string): UserSubmission[] | null {
  const fetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const submissions = useAsyncData(fetcher, `user:submissions:${keyId}`)
  if (submissions.status === "error") return []
  if (submissions.status !== "success") return null
  const seen = new Set<string>()
  return submissions.data.submissions.filter((s) => !seen.has(s.videoId) && seen.add(s.videoId))
}
