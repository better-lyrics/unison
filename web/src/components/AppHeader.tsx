import { IconMenu2, IconX } from "@tabler/icons-react"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { usePresence } from "@/hooks/usePresence"
import { cn } from "@/lib/cn"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import { type PageWidth, pageWidthClass } from "@/lib/page-width"
import { BetterLyricsLogo } from "./BetterLyricsLogo"
import { CouncilNavLink } from "./council/CouncilNavLink"
import { SearchBar } from "./SearchBar"
import { IconSwap } from "./icons/IconSwap"
import { SignInControl } from "./SignInControl"
import { artTextShadowClass, glassClass, popoverSurfaceClass } from "./ui"

const tabClass = ({ isActive }: { isActive: boolean }) =>
	cn(
		"relative inline-flex h-[30px] items-center rounded-[9px] px-2.5 text-sm font-medium transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-[5px]",
		isActive ? "bg-white/[0.08] text-unison-text" : "text-(--ink-2) hover:bg-white/[0.08] hover:text-unison-text",
	)

const deskTabClass = ({ isActive }: { isActive: boolean }) =>
	cn(
		"relative inline-flex h-[30px] items-center rounded-[9px] px-2.5 text-sm font-medium transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-[5px] hover:bg-white/[0.04]",
		isActive ? "text-unison-text" : "text-(--ink-2) hover:text-unison-text",
	)

const navPill = (active: boolean) =>
	active ? (
		<motion.span
			layoutId="nav-pill"
			transition={LAYOUT_TRANSITION}
			style={{ borderRadius: 9 }}
			className="absolute inset-0 bg-white/[0.08]"
		/>
	) : null

function NavTab({ to, end, children }: { to: string; end?: boolean; children: string }) {
	return (
		<NavLink to={to} end={end} className={deskTabClass}>
			{({ isActive }) => (
				<>
					{navPill(isActive)}
					<span className="relative">{children}</span>
				</>
			)}
		</NavLink>
	)
}

export function AppHeader({ width }: { width: PageWidth }) {
	const [menuOpen, setMenuOpen] = useState(false)
	const menu = usePresence(menuOpen)
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
				width === "wide"
					? "sticky bg-[rgba(15,14,19,0.28)] shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)] backdrop-blur-[20px] backdrop-saturate-150"
					: "relative",
			)}
		>
			<div
				className={cn(
					"mx-auto flex items-center justify-between gap-4 py-4 lg:grid lg:grid-cols-[auto_auto_1fr_auto] lg:gap-6",
					pageWidthClass(width),
				)}
			>
				<Link
					to="/"
					aria-label="Unison home"
					className={cn(
						"flex items-center gap-2 transition-opacity hover:opacity-80 lg:justify-self-start",
						artTextShadowClass,
					)}
				>
					<BetterLyricsLogo size={20} />
					<span className="text-base font-semibold tracking-tight">Unison</span>
				</Link>
				<nav
					className={cn(
						"hidden items-center lg:flex lg:justify-self-start",
						glassClass,
						"gap-0.5 rounded-xl p-[3px]",
					)}
				>
					<NavTab to="/" end>
						Songs
					</NavTab>
					<NavTab to="/curators">Leaderboard</NavTab>
					<CouncilNavLink className={deskTabClass} indicator={navPill} />
					<NavTab to="/about">About</NavTab>
					<NavTab to="/downloads">Downloads</NavTab>
					<NavTab to="/docs">Docs</NavTab>
				</nav>
				<div className="hidden lg:flex lg:justify-self-end lg:w-full lg:max-w-xs">
					<SearchBar glass />
				</div>
				<div className="flex items-center gap-2 lg:justify-self-end">
					<div className="lg:hidden">
						<SearchBar compact glass />
					</div>
					<div className="hidden lg:block">
						<SignInControl glass />
					</div>
					<button
						type="button"
						onClick={() => setMenuOpen((o) => !o)}
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						className="group flex cursor-pointer max-sm:-mr-2 rounded-md p-1.5 text-unison-text transition-colors hover:bg-unison-bg-hover lg:hidden"
					>
						<IconSwap
							swapped={menuOpen}
							from={<IconMenu2 className="size-full" stroke={1.5} />}
							to={<IconX className="size-full" stroke={1.5} />}
							className="size-5 opacity-70 transition-opacity group-hover:opacity-100"
						/>
					</button>
				</div>
			</div>
			{menu.mounted ? (
				<div
					role="menu"
					data-origin="top-right"
					className={cn(popoverSurfaceClass, "t-dropdown absolute right-6 top-full mt-2 flex w-56 flex-col gap-2 rounded-2xl p-3 lg:hidden", menu.closing && "is-closing")}
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
