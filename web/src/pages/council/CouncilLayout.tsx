import { useSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { CommandMenu } from "@/components/council/CommandMenu"
import { CouncilRail } from "@/components/council/CouncilRail"
import { ShortcutsSheet } from "@/components/council/ShortcutsSheet"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import type { CouncilContext } from "./context"

const SHELL =
  "-my-8 grid council:min-h-[calc(100dvh-var(--app-header-h))] council:grid-cols-[232px_minmax(0,1fr)] council:gap-x-14"
const CONTENT = "min-w-0 pb-30 council:pt-8"

export function CouncilLayout() {
  const session = useSession()
  if (session.status === "loading") return <CouncilSkeleton />
  if (session.status !== "signed-in") {
    return (
      <EmptyState
        title="Not signed in"
        hint="Sign in with Better Lyrics from the header to open the council dashboard."
      />
    )
  }
  if (!session.identity.council) {
    return <EmptyState title="Council members only" hint="This dashboard is for Better Lyrics Council members." />
  }
  return <CouncilShell meKeyId={session.identity.keyId} />
}

function CouncilShell({ meKeyId }: { meKeyId: string }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  useCouncilShortcuts({
    "mod+k": () => {
      setKeysOpen(false)
      setMenuOpen((open) => !open)
    },
    "?": () => {
      setMenuOpen(false)
      setKeysOpen(true)
    },
    "g o": () => {
      navigate("/council")
    },
    "g q": () => {
      navigate("/council/queue")
    },
    "g e": () => {
      navigate("/council/edits")
    },
    "g a": () => {
      navigate("/council/activity")
    },
  })
  return (
    <div className={SHELL}>
      <CouncilRail meKeyId={meKeyId} onOpenMenu={() => setMenuOpen(true)} onOpenKeys={() => setKeysOpen(true)} />
      <div className={CONTENT}>
        <Outlet context={{ meKeyId } satisfies CouncilContext} />
      </div>
      <CommandMenu open={menuOpen} onOpenChange={setMenuOpen} />
      <ShortcutsSheet open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  )
}

function CouncilSkeleton() {
  return (
    <div className={SHELL} aria-busy="true">
      <div className="hidden flex-col gap-1 py-8 council:flex">
        {skeletonKeys("rail", 7).map((key) => (
          <Bone key={key} className="h-8 w-full" />
        ))}
      </div>
      <div className={`${CONTENT} max-council:pt-8`}>
        <Bone className="h-8 w-56" />
        <Bone className="mt-8 h-64 w-full" />
      </div>
    </div>
  )
}
