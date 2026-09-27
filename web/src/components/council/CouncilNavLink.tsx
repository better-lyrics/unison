import { useCouncilRole, useOpenWorkCount } from "@/hooks/useCouncilData"
import { plural } from "@/lib/format"
import { NavLink, type NavLinkProps } from "react-router-dom"

interface CouncilNavLinkProps {
  className: NavLinkProps["className"]
  role?: string
  onClick?: () => void
}

export function CouncilNavLink(props: CouncilNavLinkProps) {
  if (useCouncilRole() === null) return null
  return <MemberLink {...props} />
}

function MemberLink({ className, role, onClick }: CouncilNavLinkProps) {
  const open = useOpenWorkCount()
  return (
    <NavLink
      to="/council"
      role={role}
      onClick={onClick}
      aria-label={open > 0 ? `Council, ${plural(open, "open item", "open items")}` : undefined}
      className={(state) => {
        const base = typeof className === "function" ? className(state) : className
        return `${base ?? ""} inline-flex items-center gap-1.5`
      }}
    >
      Council
      {open > 0 ? (
        <span className="min-w-4 rounded-full bg-unison-medal-gold-wash px-1 text-center font-mono text-[10px] leading-4 text-unison-medal-gold tabular-nums">
          {open}
        </span>
      ) : null}
    </NavLink>
  )
}
