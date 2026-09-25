import { useState } from "react"
import { resolveAvatar } from "@/lib/avatar"

interface UserAvatarProps {
  avatarUrl?: string | null
  keyId: string
  className?: string
  loading?: "lazy" | "eager"
}

export function UserAvatar({ avatarUrl, keyId, className, loading }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const usable = avatarUrl && avatarUrl !== failedUrl ? avatarUrl : null
  return (
    <img
      src={resolveAvatar({ avatarUrl: usable, keyId })}
      alt=""
      className={className}
      loading={loading}
      onError={() => {
        if (usable) setFailedUrl(usable)
      }}
    />
  )
}
