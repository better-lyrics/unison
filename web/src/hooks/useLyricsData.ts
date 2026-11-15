import {
  fetchLyricsVariant,
  fetchLyricsVariants,
  fetchMySuggestions,
  fetchRevisionDetail,
  fetchRevisionDiff,
  fetchRevisions,
} from "@/lib/api"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

export const lyricsKeys = {
  variants: (videoId: string) => ["lyrics", "variants", videoId] as const,
  variant: (id: number | undefined) => ["lyrics", "variant", id] as const,
  revisions: (lyricsId: number) => ["lyrics", "revisions", lyricsId] as const,
  revision: (lyricsId: number, revisionId: number) => ["lyrics", "revision", lyricsId, revisionId] as const,
  diff: (lyricsId: number, revisionId: number) => ["lyrics", "diff", lyricsId, revisionId] as const,
  allSuggestions: ["lyrics", "suggestions", "mine"] as const,
  suggestions: (keyId: string | null) => ["lyrics", "suggestions", "mine", keyId] as const,
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
    placeholderData: keepPreviousData,
  })
}

export function useRevisions(lyricsId: number) {
  return useQuery({
    queryKey: lyricsKeys.revisions(lyricsId),
    queryFn: ({ signal }) => fetchRevisions(lyricsId, signal),
    staleTime: STALE_MS,
  })
}

export function useMySuggestions(keyId: string | null) {
  return useQuery({
    queryKey: lyricsKeys.suggestions(keyId),
    queryFn: ({ signal }) => fetchMySuggestions(signal),
    enabled: keyId !== null,
    staleTime: STALE_MS,
  })
}

export function useRevisionDiff(lyricsId: number, revisionId: number, enabled = true) {
  return useQuery({
    queryKey: lyricsKeys.diff(lyricsId, revisionId),
    queryFn: ({ signal }) => fetchRevisionDiff(lyricsId, revisionId, signal),
    enabled,
    staleTime: STALE_MS,
  })
}

export function useRevisionDetail(lyricsId: number, revisionId: number, enabled: boolean) {
  return useQuery({
    queryKey: lyricsKeys.revision(lyricsId, revisionId),
    queryFn: ({ signal }) => fetchRevisionDetail(lyricsId, revisionId, signal),
    enabled,
    staleTime: STALE_MS,
  })
}
