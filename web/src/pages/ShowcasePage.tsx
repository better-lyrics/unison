import { appTileClass, buttonClass, heroPanelClass, panelClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { EASE_OUT, staggerDelay, thudFrom, thudTransition } from "@/lib/motion-variants"
import { SHOWCASE_APPS, SHOWCASE_SUBMIT_URL, type ShowcaseApp } from "@/lib/showcase"
import { sleeveCss } from "@/lib/sleeve"
import { IconArrowUpRight } from "@tabler/icons-react"
import { MotionConfig, motion } from "motion/react"
import { useId, useState } from "react"

const HERO_ICONS_AT = 0.1
const HERO_TEXT_AT = 0.3
const HERO_ACTION_AT = 0.45
const CARDS_AT = 0.35

const heroIcon = thudFrom(1.8)
const heroAction = thudFrom(1.25, 0.06)
const ICON_TILTS = [-8, 6, -3]

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function AppIcon({ app, className }: { app: ShowcaseApp; className: string }) {
  const [failed, setFailed] = useState(!app.icon)
  return (
    <span className={cn(appTileClass, "overflow-hidden", className)}>
      {failed ? (
        <span
          className="grid size-full place-items-center text-xl font-bold text-white/90"
          style={{ background: sleeveCss(app.name, "") }}
        >
          {Array.from(app.name)[0]?.toUpperCase()}
        </span>
      ) : (
        <img
          src={app.icon}
          alt=""
          onError={() => setFailed(true)}
          className={app.iconFillsTile ? "size-full object-cover" : "size-[62%] object-contain"}
        />
      )}
    </span>
  )
}

function AppCard({ app, index }: { app: ShowcaseApp; index: number }) {
  const nameId = useId()
  return (
    <motion.a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-labelledby={nameId}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: CARDS_AT + staggerDelay(index), ease: EASE_OUT }}
      className={cn(
        panelClass,
        "group flex flex-col gap-4 p-5 transition-colors duration-150 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-unison-border-strong",
      )}
    >
      <div className="flex items-center gap-3.5">
        <AppIcon key={app.icon} app={app} className="size-14" />
        <div className="min-w-0 flex-1">
          <h2 id={nameId} className="truncate text-base font-semibold text-unison-text">
            {app.name}
          </h2>
          <p className="truncate text-xs text-unison-text-muted">{displayUrl(app.url)}</p>
        </div>
        <IconArrowUpRight
          className="size-5 shrink-0 self-start text-unison-text opacity-40 transition-[opacity,translate] duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
          stroke={1.5}
          aria-hidden="true"
        />
      </div>
      <p className="line-clamp-3 text-sm leading-relaxed text-unison-text-secondary">{app.description}</p>
      {app.platforms.length > 0 && (
        <ul className="mt-auto flex flex-wrap gap-1.5" aria-label="Platforms">
          {app.platforms.map((platform) => (
            <li
              key={platform}
              className="max-w-full truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-unison-text-secondary"
            >
              {platform}
            </li>
          ))}
        </ul>
      )}
    </motion.a>
  )
}

export function ShowcasePage({ apps = SHOWCASE_APPS }: { apps?: ShowcaseApp[] }) {
  const featured = apps.filter((app) => app.featured).slice(0, ICON_TILTS.length)
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6">
        <section className={heroPanelClass}>
          {featured.length > 0 && (
            <div className="flex shrink-0 -space-x-4 pl-1" aria-hidden="true">
              {featured.map((app, i) => (
                <motion.span
                  key={app.name}
                  className="block"
                  style={{ rotate: ICON_TILTS[i] }}
                  {...heroIcon}
                  transition={thudTransition(HERO_ICONS_AT + i * 0.08)}
                >
                  <AppIcon key={app.icon} app={app} className="size-16 shadow-[0_8px_24px_rgba(0,0,0,0.35)]" />
                </motion.span>
              ))}
            </div>
          )}
          <motion.div
            className="min-w-0 flex-1"
            initial={{ opacity: 0, x: -8, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.42, delay: HERO_TEXT_AT, ease: EASE_OUT }}
          >
            <h1 className="text-[22px] font-bold tracking-tight text-unison-text">Built with Unison</h1>
            <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-unison-text-secondary">
              These beautiful apps use Unison and give credit to the people who put in the hard work.
            </p>
          </motion.div>
          <motion.div className="shrink-0" {...heroAction} transition={thudTransition(HERO_ACTION_AT)}>
            <a
              href={SHOWCASE_SUBMIT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonClass("primary", "sm"), "w-full")}
            >
              Add your app
            </a>
          </motion.div>
        </section>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
          {apps.map((app, i) => (
            <AppCard key={app.name} app={app} index={i} />
          ))}
        </div>
      </div>
    </MotionConfig>
  )
}
