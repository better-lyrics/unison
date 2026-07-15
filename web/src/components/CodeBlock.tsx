import { IconCheck, IconCopy } from "@tabler/icons-react"
import { Highlight, type Language, themes } from "prism-react-renderer"
import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { cn } from "@/lib/cn"

// bash is hand-tokenized; everything else is any language prism bundles (json, javascript, python, go, ...).
export type CodeLang = Language | "bash"

// Shared so picking a language in one CodeTabs switches every other one, and the choice survives reloads.
interface CodeLangValue {
  selected: string
  setSelected: (label: string) => void
}

const CodeLangContext = createContext<CodeLangValue | null>(null)
const STORAGE_KEY = "unison:docs:code-lang"

export function CodeLangProvider({ children, fallback = "cURL" }: { children: ReactNode; fallback?: string }) {
  const [selected, setSelectedState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? fallback
    } catch {
      return fallback
    }
  })
  const setSelected = useCallback((label: string) => {
    setSelectedState(label)
    try {
      localStorage.setItem(STORAGE_KEY, label)
    } catch {
      // storage may be unavailable (private mode); the in-memory choice still syncs across blocks
    }
  }, [])
  return <CodeLangContext.Provider value={{ selected, setSelected }}>{children}</CodeLangContext.Provider>
}

const PLAIN = "#d6deeb"
const preClass =
  "unison-code-scroll overflow-x-auto px-4 py-3 pr-12 font-mono text-xs leading-relaxed [font-variant-ligatures:none]"

// prism-react-renderer ships no bash grammar, so bash is tokenized by hand.
// Colors track the nightOwl palette prism uses for json / javascript so every block reads as one theme.
const BASH = {
  command: "#82aaff",
  string: "#addb67",
  flag: "#c792ea",
  comment: "#637777",
} as const

function highlightBashLine(line: string, lineIdx: number): ReactNode[] {
  if (line.trimStart().startsWith("#")) {
    return [
      <span key={`${lineIdx}-c`} style={{ color: BASH.comment, fontStyle: "italic" }}>
        {line}
      </span>,
    ]
  }
  if (line.length === 0) return [""]
  const parts = line.split(/(\s+)/)
  const out: ReactNode[] = []
  let seenCommand = false
  for (let i = 0; i < parts.length; i += 2) {
    const word = parts[i] ?? ""
    const ws = parts[i + 1] ?? ""
    const key = `${lineIdx}-${i}`
    if (word.length === 0) {
      if (ws.length > 0) out.push(<span key={key}>{ws}</span>)
      continue
    }
    let color: string | undefined
    if (!seenCommand) {
      color = BASH.command
      seenCommand = true
    } else if (/^--?\w/.test(word)) {
      color = BASH.flag
    } else if (word.startsWith('"') || word.startsWith("'")) {
      color = BASH.string
    }
    out.push(
      color ? (
        <span key={key} style={{ color }}>
          {word + ws}
        </span>
      ) : (
        <span key={key}>{word + ws}</span>
      ),
    )
  }
  return out
}

function BashCode({ code }: { code: string }) {
  const lines = code.split("\n")
  return (
    <>
      {lines.map((line, lineIdx) => (
        <Fragment key={`line-${lineIdx}-${line.slice(0, 8)}`}>
          {lineIdx > 0 ? "\n" : null}
          {highlightBashLine(line, lineIdx)}
        </Fragment>
      ))}
    </>
  )
}

function PrismCode({ code, language }: { code: string; language: Language }) {
  return (
    <Highlight theme={themes.nightOwl} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <>
          {tokens.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable line indices
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable token indices
                <span key={j} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </>
      )}
    </Highlight>
  )
}

function Highlighted({ code, language }: { code: string; language: CodeLang }) {
  return language === "bash" ? <BashCode code={code} /> : <PrismCode code={code} language={language} />
}

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("clipboard write failed", err)
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "group cursor-pointer rounded-md p-1 text-unison-text transition-colors hover:bg-unison-bg-hover",
        className,
      )}
    >
      {copied ? (
        <IconCheck className="size-4 opacity-50 transition-opacity group-hover:opacity-100" stroke={1.5} />
      ) : (
        <IconCopy className="size-4 opacity-50 transition-opacity group-hover:opacity-100" stroke={1.5} />
      )}
    </button>
  )
}

export function CodeBlock({ code, language, label }: { code: string; language: CodeLang; label?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50">
      {label ? (
        <div className="border-b border-unison-border/50 px-4 py-2">
          <span className="text-xs font-medium text-unison-text-muted">{label}</span>
        </div>
      ) : null}
      <pre className={preClass} style={{ color: PLAIN }}>
        <Highlighted code={code} language={language} />
      </pre>
      <CopyButton value={code} label="Copy code" className="absolute right-2 top-2" />
    </div>
  )
}

export interface CodeTab {
  label: string
  code: string
  language: CodeLang
}

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const shared = useContext(CodeLangContext)
  const [localSelected, setLocalSelected] = useState(tabs[0]?.label ?? "")
  const selected = shared ? shared.selected : localSelected
  const setSelected = shared ? shared.setSelected : setLocalSelected

  const found = tabs.findIndex((tab) => tab.label === selected)
  const active = found >= 0 ? found : 0

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const measure = useCallback(() => {
    const el = tabRefs.current[active]
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [active])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [measure])

  const current = tabs[active]

  return (
    <div className="relative overflow-hidden rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50">
      <div role="tablist" className="relative flex gap-4 border-b border-unison-border/50 px-4">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setSelected(tab.label)}
            className={cn(
              "cursor-pointer pb-2.5 pt-2 text-xs font-medium transition-colors",
              i === active ? "text-unison-text" : "text-unison-text-secondary hover:text-unison-text",
            )}
          >
            {tab.label}
          </button>
        ))}
        <span
          className="absolute bottom-0 h-0.5 rounded bg-unison-text transition-all duration-200"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>
      <div className="relative">
        <pre className={preClass} style={{ color: PLAIN }}>
          <Highlighted code={current.code} language={current.language} />
        </pre>
        <CopyButton value={current.code} label="Copy code" className="absolute right-2 top-2" />
      </div>
    </div>
  )
}
