import { Link } from "react-router-dom"

const previews = [
  { to: "/dev/link", title: "Link UI", desc: "Every state of the link page and Discord section." },
  { to: "/dev/curators", title: "Curators", desc: "Leaderboard rows with Discord icons, from fixtures." },
  { to: "/dev/me", title: "Me page", desc: "Profile, nickname, and Discord cards from fixtures." },
  { to: "/dev/migrate", title: "Migrate UI", desc: "Every state of the account migration page." },
]

export default function DevIndex() {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-unison-text">Dev previews</h2>
      <ul className="space-y-2">
        {previews.map((p) => (
          <li key={p.to}>
            <Link
              to={p.to}
              className="block rounded-lg border border-unison-border bg-unison-bg-elevated p-4 transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover"
            >
              <p className="text-sm font-medium text-unison-text">{p.title}</p>
              <p className="text-xs text-unison-text-muted">{p.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
