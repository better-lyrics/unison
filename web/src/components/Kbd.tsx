import { cn } from "@/lib/cn"
import { formatKey } from "@/lib/format-key"
import { isMac as platformIsMac } from "@/lib/platform"
import { IconCommand } from "@tabler/icons-react"
import { Fragment } from "react"

interface KbdProps {
  keys: string[]
  isMac?: boolean
  className?: string
}

export function Kbd({ keys, isMac = platformIsMac, className }: KbdProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key) => (
        <span
          key={key}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-current/10 px-1 text-[10px] font-medium leading-none shadow-[0_2px_0_0_rgba(0,0,0,0.3)]"
        >
          {key === "Mod" && isMac ? <IconCommand className="size-2.5" /> : formatKey(key, isMac)}
        </span>
      ))}
    </span>
  )
}

export function KeySteps({ keys, word }: { keys: string[]; word: "then" | "or" }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 ? <span className="text-[10px]">{word}</span> : null}
          <Kbd keys={[key]} />
        </Fragment>
      ))}
    </span>
  )
}
