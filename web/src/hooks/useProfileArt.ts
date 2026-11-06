import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { backedImage, sampleAccent } from "@/lib/accent"
import { artworkImageUrl, sizedArtworkUrl } from "@/lib/artwork"
import { sleeveDataUrl } from "@/lib/sleeve"
import type { UserRankResponse } from "@/lib/types"

const BANNER_SIZE = 2048
const SLEEVE_SIZE = 630

export interface ProfileArt {
  banner: string | null
  wash: string | null
  avatar: string | null | undefined
}

async function backAvatar(src: string): Promise<string> {
  try {
    return await backedImage(src, await sampleAccent(src))
  } catch (error: unknown) {
    console.warn("Could not back the avatar", error)
    return src
  }
}

export function useProfileArt(rank: UserRankResponse): ProfileArt {
  const { avatarUrl, displayName, keyId } = rank
  const banner = rank.banner ? sizedArtworkUrl(rank.banner.artworkUrl, BANNER_SIZE) : null
  const { data: backed } = useQuery({
    queryKey: ["backed-avatar", avatarUrl],
    queryFn: () => backAvatar(avatarUrl ?? ""),
    enabled: Boolean(avatarUrl),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const sleeve = useMemo(
    () => (avatarUrl ? null : sleeveDataUrl(displayName, keyId, SLEEVE_SIZE)),
    [avatarUrl, displayName, keyId],
  )
  const avatar = avatarUrl ? (backed ?? avatarUrl) : avatarUrl
  const bannerWash = rank.banner ? artworkImageUrl(rank.banner.videoId) : null
  return { banner, wash: bannerWash ?? (avatarUrl ? (backed ?? null) : sleeve), avatar }
}
