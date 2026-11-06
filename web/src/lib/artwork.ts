import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { fetchArtwork } from "@/lib/api"

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
}

export function youtubeThumbnailFallbackUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

const ARTWORK_SIZE = /=w\d+-h\d+/

export function sizedArtworkUrl(url: string, size: number): string {
  return url.replace(ARTWORK_SIZE, `=w${size}-h${size}`)
}

export function useArtwork(
  videoId: string,
  opts: { enabled?: boolean; size?: number } = {},
): UseQueryResult<string | null> {
  return useQuery({
    queryKey: ["artwork", videoId, opts.size ?? null],
    queryFn: () => fetchArtwork(videoId, opts.size),
    enabled: (opts.enabled ?? true) && videoId.length > 0,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
  })
}
