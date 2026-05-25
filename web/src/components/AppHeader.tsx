import { NavLink } from "react-router-dom"
import { cn } from "@/lib/cn"
import { BetterLyricsLogo } from "./BetterLyricsLogo"
import { SignInControl } from "./SignInControl"

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
      <div className="mx-auto grid max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-6 px-6 py-4">
        <div className="flex items-center gap-2 justify-self-start">
          <BetterLyricsLogo size={20} />
          <span className="text-base font-semibold tracking-tight">Unison</span>
        </div>
        <nav className="flex items-center gap-1 justify-self-center">
          <NavLink to="/" end className={tabClass}>
            Songs
          </NavLink>
          <NavLink to="/leaderboard" className={tabClass}>
            Leaderboard
          </NavLink>
          <NavLink to="/about" className={tabClass}>
            About
          </NavLink>
        </nav>
        <div className="justify-self-end">
          <SignInControl />
        </div>
      </div>
    </header>
  )
}
