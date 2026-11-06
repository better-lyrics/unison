import type { ReactNode } from "react"
import { UserAvatar } from "@/components/UserAvatar"
import type { MarkActor } from "@/lib/types"

export function SubmitterLine({
  submitter,
  nameClassName,
  children,
  title,
}: {
  submitter: MarkActor
  nameClassName?: string
  children?: ReactNode
  title?: string
}) {
  return (
    <>
      <UserAvatar
        avatarUrl={submitter.avatarUrl}
        keyId={submitter.keyId}
        className="size-4 shrink-0 rounded-full"
        loading="lazy"
      />
      <span title={title} className="min-w-0 truncate">
        <span className={nameClassName}>{submitter.displayName}</span>
        {children}
      </span>
    </>
  )
}
