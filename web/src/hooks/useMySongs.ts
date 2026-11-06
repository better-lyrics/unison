import { useCallback } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserSubmissions } from "@/lib/api"
import type { UserSubmission } from "@/lib/types"

export type MySongs = { status: "loading" | "error" } | { status: "success"; songs: UserSubmission[] }

export function useMySongs(keyId: string): MySongs {
  const fetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const submissions = useAsyncData(fetcher, `user:submissions:${keyId}`)
  if (submissions.status !== "success") return { status: submissions.status === "error" ? "error" : "loading" }
  const seen = new Set<string>()
  const songs = submissions.data.submissions.filter((s) => !seen.has(s.videoId) && seen.add(s.videoId))
  return { status: "success", songs }
}
