import { NavLink } from "react-router-dom"
import { cn } from "@/lib/cn"
import { BetterLyricsLogo } from "./BetterLyricsLogo"

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-unison-bg-elevated text-unison-text"
      : "text-unison-text-secondary hover:text-unison-text hover:bg-unison-bg-hover",
  )

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-unison-border bg-unison-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <BetterLyricsLogo size={20} className="text-unison-accent" />
          <span className="text-base font-semibold tracking-tight">Unison</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={tabClass}>
            Songs
          </NavLink>
          <NavLink to="/curators" className={tabClass}>
            Curators
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
