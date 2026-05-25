import { useEffect, useState } from "react"
import { useSession } from "@/auth/useSession"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { isExtensionAvailable } from "@/lib/extension"

export function SignInControl() {
  const session = useSession()
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    isExtensionAvailable().then((ok) => {
      if (!cancelled) setExtensionReady(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (session.status === "loading") {
    return <div data-state="loading" className="h-8 w-24 animate-pulse rounded-md bg-unison-bg-elevated" />
  }

  if (session.status === "signed-in") {
    return (
      <div className="flex items-center gap-2" data-state="signed-in" aria-label={session.identity.displayName}>
        <img
          src={dicebearThumbsDataUri(session.identity.keyId)}
          alt=""
          className="size-7 rounded-full border border-unison-border bg-unison-bg-hover"
        />
        <span className="hidden text-sm font-medium text-unison-text sm:inline">{session.identity.displayName}</span>
        <button
          type="button"
          onClick={session.signOut}
          className="text-xs text-unison-text-muted transition-colors hover:text-unison-text"
        >
          Sign out
        </button>
      </div>
    )
  }

  if (extensionReady !== true) {
    return <div data-state="signed-out" className="h-8 w-44" />
  }

  return (
    <button
      type="button"
      onClick={session.signIn}
      className="rounded-md bg-unison-bg-elevated px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover"
      data-state="signed-out"
    >
      Sign in with Better Lyrics
    </button>
  )
}
