import { IconMenu2, IconX } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { cn } from "@/lib/cn"
import { useArtChrome } from "@/lib/route-chrome"
import { type PageWidth, pageWidthClass } from "@/lib/page-width"
import { BetterLyricsLogo } from "./BetterLyricsLogo"
import { CouncilNavLink } from "./council/CouncilNavLink"
import { SearchBar } from "./SearchBar"
import { SignInControl } from "./SignInControl"
import { artTextShadowClass, glassClass } from "./ui"

const artTabClass = ({ isActive }: { isActive: boolean }) =>
	cn(
		"inline-flex h-[30px] items-center rounded-[9px] px-2.5 text-sm font-medium transition-colors duration-150",
		isActive ? "bg-white/[0.08] text-unison-text" : "text-(--ink-2) hover:bg-white/[0.08] hover:text-unison-text",
	)

const tabClass = ({ isActive }: { isActive: boolean }) =>
	cn(
		"rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
		isActive
			? "bg-unison-bg-elevated text-unison-text"
			: "text-unison-text-secondary hover:text-unison-text hover:bg-unison-bg-hover",
	)

export function AppHeader({ width }: { width: PageWidth }) {
	const [menuOpen, setMenuOpen] = useState(false)
	const art = useArtChrome()
	const navTab = art ? artTabClass : tabClass
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
			className={cn(
				"top-0 z-10",
				art ? "relative" : "sticky border-b border-unison-border bg-unison-bg/80 backdrop-blur",
			)}
		>
			<div
				className={cn(
					"mx-auto flex items-center justify-between gap-4 py-4 sm:grid sm:grid-cols-[auto_auto_1fr_auto] sm:gap-6",
					pageWidthClass(width),
				)}
			>
				<Link
					to="/"
					aria-label="Unison home"
					className={cn(
						"flex items-center gap-2 transition-opacity hover:opacity-80 sm:justify-self-start",
						art && artTextShadowClass,
					)}
				>
					<BetterLyricsLogo size={20} />
					<span className="text-base font-semibold tracking-tight">Unison</span>
				</Link>
				<nav
					className={cn(
						"hidden items-center sm:flex sm:justify-self-start",
						art ? cn(glassClass, "gap-0.5 rounded-xl p-[3px]") : "gap-1",
					)}
				>
					<NavLink to="/" end className={navTab}>
						Songs
					</NavLink>
					<NavLink to="/curators" className={navTab}>
						Leaderboard
					</NavLink>
					<CouncilNavLink className={navTab} />
					<NavLink to="/about" className={navTab}>
						About
					</NavLink>
					<NavLink to="/downloads" className={navTab}>
						Downloads
					</NavLink>
					<NavLink to="/docs" className={navTab}>
						Docs
					</NavLink>
				</nav>
				<div className="hidden sm:flex sm:justify-self-end sm:w-full sm:max-w-xs">
					<SearchBar glass={art} />
				</div>
				<div className="flex items-center gap-2 sm:justify-self-end">
					<div className="sm:hidden">
						<SearchBar compact />
					</div>
					<div className="hidden sm:block">
						<SignInControl glass={art} />
					</div>
					<button
						type="button"
						onClick={() => setMenuOpen((o) => !o)}
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						className="group cursor-pointer rounded-md p-1.5 text-unison-text transition-colors hover:bg-unison-bg-hover sm:hidden"
					>
						{menuOpen ? (
							<IconX className="size-5 opacity-70 transition-opacity group-hover:opacity-100" stroke={1.5} />
						) : (
							<IconMenu2 className="size-5 opacity-70 transition-opacity group-hover:opacity-100" stroke={1.5} />
						)}
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
						<NavLink to="/curators" role="menuitem" onClick={closeMenu} className={tabClass}>
							Leaderboard
						</NavLink>
						<CouncilNavLink role="menuitem" onClick={closeMenu} className={tabClass} />
						<NavLink to="/about" role="menuitem" onClick={closeMenu} className={tabClass}>
							About
						</NavLink>
						<NavLink to="/downloads" role="menuitem" onClick={closeMenu} className={tabClass}>
							Downloads
						</NavLink>
						<NavLink to="/docs" role="menuitem" onClick={closeMenu} className={tabClass}>
							Docs
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
