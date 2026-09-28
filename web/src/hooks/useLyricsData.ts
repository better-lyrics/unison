import { fetchLyricsVariant, fetchLyricsVariants, fetchRevisionDiff, fetchRevisions } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

export const lyricsKeys = {
  variants: (videoId: string) => ["lyrics", "variants", videoId] as const,
  variant: (id: number | undefined) => ["lyrics", "variant", id] as const,
  revisions: (lyricsId: number) => ["lyrics", "revisions", lyricsId] as const,
  diff: (lyricsId: number, revisionId: number) => ["lyrics", "diff", lyricsId, revisionId] as const,
}

const STALE_MS = 30_000

export function useLyricsVariants(videoId: string) {
  return useQuery({
    queryKey: lyricsKeys.variants(videoId),
    queryFn: ({ signal }) => fetchLyricsVariants(videoId, { signal }),
    enabled: videoId.length > 0,
    staleTime: STALE_MS,
  })
}

export function useLyricsVariant(id: number | undefined) {
  return useQuery({
    queryKey: lyricsKeys.variant(id),
    queryFn: ({ signal }) => {
      if (id === undefined) throw new Error("no variant selected")
      return fetchLyricsVariant(id, { signal })
    },
    enabled: id !== undefined,
    staleTime: STALE_MS,
  })
}

export function useRevisions(lyricsId: number) {
  return useQuery({
    queryKey: lyricsKeys.revisions(lyricsId),
    queryFn: ({ signal }) => fetchRevisions(lyricsId, signal),
    staleTime: STALE_MS,
  })
}

export function useRevisionDiff(lyricsId: number, revisionId: number) {
  return useQuery({
    queryKey: lyricsKeys.diff(lyricsId, revisionId),
    queryFn: ({ signal }) => fetchRevisionDiff(lyricsId, revisionId, signal),
    staleTime: STALE_MS,
  })
}
