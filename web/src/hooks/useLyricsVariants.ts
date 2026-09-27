import { fetchLyricsVariant, fetchLyricsVariants } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

export const lyricsKeys = {
  variants: (videoId: string) => ["lyrics", "variants", videoId] as const,
  variant: (id: number | undefined) => ["lyrics", "variant", id] as const,
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
