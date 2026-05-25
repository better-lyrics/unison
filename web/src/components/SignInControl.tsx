import { IconCheck, IconCopy, IconLogout, IconUser } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useSession } from "@/auth/useSession"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { isExtensionAvailable } from "@/lib/extension"

export function SignInControl() {
  const session = useSession()
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    isExtensionAvailable().then((ok) => {
      if (!cancelled) setExtensionReady(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (session.status === "loading") {
    return <div data-state="loading" className="h-8 w-24 animate-pulse rounded-md bg-unison-bg-elevated" />
  }

  if (session.status === "signed-in") {
    const { identity } = session
    const copyKey = async () => {
      await navigator.clipboard.writeText(identity.keyId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
    const signOut = () => {
      setOpen(false)
      session.signOut()
    }
    return (
      <div className="relative" ref={wrapperRef} data-state="signed-in">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={identity.displayName}
          className="flex cursor-pointer items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-unison-bg-hover"
        >
          <img
            src={dicebearThumbsDataUri(identity.keyId)}
            alt=""
            className="size-7 rounded-full border border-unison-border bg-unison-bg-hover"
          />
          <span className="hidden text-sm font-medium text-unison-text sm:inline">{identity.displayName}</span>
        </button>
        {open ? (
          <div
            role="menu"
            data-state="open"
            className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-unison-border bg-unison-bg-elevated p-3 shadow-lg"
          >
            <div className="space-y-2 pb-3">
              <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">Key ID</p>
              <div className="flex items-center gap-2">
                <code
                  title={identity.keyId}
                  className="min-w-0 flex-1 font-mono text-xs text-unison-text"
                >
                  {`${identity.keyId.slice(0, 6)}…${identity.keyId.slice(-6)}`}
                </code>
                <button
                  type="button"
                  onClick={copyKey}
                  aria-label={copied ? "Copied" : "Copy key id"}
                  className="cursor-pointer shrink-0 rounded-md p-1 text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
                >
                  {copied ? <IconCheck className="size-4" stroke={1.5} /> : <IconCopy className="size-4" stroke={1.5} />}
                </button>
              </div>
            </div>
            <div className="border-t border-unison-border pt-2">
              <Link
                to="/me"
                onClick={() => setOpen(false)}
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover"
              >
                <IconUser className="size-4" stroke={1.5} />
                View stats
              </Link>
              <button
                type="button"
                onClick={signOut}
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover"
              >
                <IconLogout className="size-4" stroke={1.5} />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  if (extensionReady === null) {
    return <div data-state="loading" className="h-8 w-44" />
  }

  if (extensionReady === false) {
    return (
      <a
        href="https://betterlyrics.org"
        target="_blank"
        rel="noopener noreferrer"
        data-state="no-extension"
        className="text-sm text-unison-text-secondary transition-colors hover:text-unison-text"
      >
        Get Better Lyrics
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={session.signIn}
      className="cursor-pointer rounded-md bg-unison-bg-elevated px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover"
      data-state="signed-out"
    >
      Sign in with Better Lyrics
    </button>
  )
}
