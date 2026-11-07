import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import type { MarkActor } from "@/lib/types"

/** A card's own link is an overlay, so the submitter links can sit above it instead of nesting inside it. */
export const CARD_LINK_OVERLAY = "absolute inset-0 z-[1] rounded-[inherit]"
const ABOVE_CARD_LINK = "relative z-[2]"

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
  const href = `/curator/${submitter.keyId}`
  return (
    <>
      <Link to={href} tabIndex={-1} aria-hidden="true" className={cn(ABOVE_CARD_LINK, "shrink-0 rounded-full")}>
        <UserAvatar
          avatarUrl={submitter.avatarUrl}
          keyId={submitter.keyId}
          className="block size-4 rounded-full"
          loading="lazy"
        />
      </Link>
      <span title={title} className="min-w-0 truncate">
        <Link
          to={href}
          className={cn(ABOVE_CARD_LINK, "transition-colors duration-150 hover:text-unison-text", nameClassName)}
        >
          {submitter.displayName}
        </Link>
        {children}
      </span>
    </>
  )
}
