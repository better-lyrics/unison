import { IconMenu2, IconX } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { cn } from "@/lib/cn"
import { BetterLyricsLogo } from "./BetterLyricsLogo"
import { SearchBar } from "./SearchBar"
import { SignInControl } from "./SignInControl"

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-unison-bg-elevated text-unison-text"
      : "text-unison-text-secondary hover:text-unison-text hover:bg-unison-bg-hover",
  )

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-10 border-b border-unison-border bg-unison-bg/80 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4 sm:grid sm:grid-cols-[auto_auto_1fr_auto] sm:gap-6">
        <Link
          to="/"
          aria-label="Unison home"
          className="flex items-center gap-2 transition-opacity hover:opacity-80 sm:justify-self-start"
        >
          <BetterLyricsLogo size={20} />
          <span className="text-base font-semibold tracking-tight">Unison</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex sm:justify-self-start">
          <NavLink to="/" end className={tabClass}>
            Songs
          </NavLink>
          <NavLink to="/leaderboard" className={tabClass}>
            Leaderboard
          </NavLink>
          <NavLink to="/about" className={tabClass}>
            About
          </NavLink>
          <NavLink to="/downloads" className={tabClass}>
            Downloads
          </NavLink>
        </nav>
        <div className="hidden sm:flex sm:justify-self-end sm:w-full sm:max-w-xs">
          <SearchBar />
        </div>
        <div className="flex items-center gap-2 sm:justify-self-end">
          <div className="sm:hidden">
            <SearchBar compact />
          </div>
          <div className="hidden sm:block">
            <SignInControl />
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="cursor-pointer rounded-md p-1.5 text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text sm:hidden"
          >
            {menuOpen ? <IconX className="size-5" stroke={1.5} /> : <IconMenu2 className="size-5" stroke={1.5} />}
          </button>
        </div>
      </div>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-6 top-full mt-2 flex w-56 flex-col gap-2 rounded-lg border border-unison-border bg-unison-bg-elevated p-3 shadow-lg sm:hidden"
        >
          <nav className="flex flex-col gap-1">
            <NavLink to="/" end role="menuitem" onClick={closeMenu} className={tabClass}>
              Songs
            </NavLink>
            <NavLink to="/leaderboard" role="menuitem" onClick={closeMenu} className={tabClass}>
              Leaderboard
            </NavLink>
            <NavLink to="/about" role="menuitem" onClick={closeMenu} className={tabClass}>
              About
            </NavLink>
            <NavLink to="/downloads" role="menuitem" onClick={closeMenu} className={tabClass}>
              Downloads
            </NavLink>
          </nav>
          <div className="flex items-center justify-end border-t border-unison-border pt-2">
            <SignInControl />
          </div>
        </div>
      ) : null}
    </header>
  )
}
