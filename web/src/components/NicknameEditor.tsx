import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "@/auth/useSession"
import {
  checkNicknameAvailability,
  deleteNickname,
  putNickname,
} from "@/lib/nickname"

const DEBOUNCE_MS = 350
const RATE_LIMIT_COOLDOWN_MS = 5000
const SAVED_FLASH_MS = 1500

type State =
  | { kind: "idle" }
  | { kind: "typing"; value: string }
  | { kind: "checking"; value: string }
  | { kind: "available"; value: string }
  | { kind: "self"; value: string }
  | { kind: "taken"; value: string }
  | { kind: "invalid"; value: string }
  | { kind: "rateLimited"; value: string }
  | { kind: "submitting"; value: string }
  | { kind: "saved"; value: string }
  | { kind: "error"; value: string; message: string }

interface StatusMeta {
  text: string
  tone: "muted" | "warn"
}

function describeStatus(state: State, currentName: string): StatusMeta | null {
  switch (state.kind) {
    case "idle":
      return { text: "Letters, numbers, underscore. 3-20 chars.", tone: "muted" }
    case "typing":
      return { text: "Letters, numbers, underscore. 3-20 chars.", tone: "muted" }
    case "checking":
      return { text: "Checking availability...", tone: "muted" }
    case "available":
      return { text: "Available", tone: "muted" }
    case "self":
      return { text: "This is your current nickname.", tone: "muted" }
    case "taken":
      return { text: "Already taken.", tone: "warn" }
    case "invalid":
      return { text: "Letters, numbers, underscore. 3-20 chars.", tone: "warn" }
    case "rateLimited":
      return { text: "Try again in a moment.", tone: "warn" }
    case "submitting":
      return { text: "Saving...", tone: "muted" }
    case "saved":
      return { text: `Saved as ${currentName}.`, tone: "muted" }
    case "error":
      return { text: state.message, tone: "warn" }
  }
}

function inputValue(state: State, fallback: string): string {
  if (state.kind === "idle" || state.kind === "saved") return fallback
  return state.value
}

export function NicknameEditor() {
  const session = useSession()
  const [state, setState] = useState<State>({ kind: "idle" })
  const requestTokenRef = useRef(0)
  const debounceRef = useRef<number | null>(null)
  const cooldownRef = useRef<number | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const clearCooldown = useCallback(() => {
    if (cooldownRef.current !== null) {
      window.clearTimeout(cooldownRef.current)
      cooldownRef.current = null
    }
  }, [])

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearDebounce()
      clearCooldown()
      clearSavedTimer()
    }
  }, [clearDebounce, clearCooldown, clearSavedTimer])

  const enterRateLimitedCooldown = useCallback(
    (value: string) => {
      setState({ kind: "rateLimited", value })
      clearCooldown()
      cooldownRef.current = window.setTimeout(() => {
        cooldownRef.current = null
        setState((prev) => (prev.kind === "rateLimited" ? { kind: "typing", value: prev.value } : prev))
      }, RATE_LIMIT_COOLDOWN_MS)
    },
    [clearCooldown],
  )

  const runAvailability = useCallback(
    async (value: string, token: number) => {
      try {
        const res = await checkNicknameAvailability(value)
        if (token !== requestTokenRef.current) return
        if (res.available && res.reason === "SELF") {
          setState({ kind: "self", value })
          return
        }
        if (res.available) {
          setState({ kind: "available", value })
          return
        }
        if (res.reason === "INVALID_FORMAT") {
          setState({ kind: "invalid", value })
          return
        }
        setState({ kind: "taken", value })
      } catch (err) {
        if (token !== requestTokenRef.current) return
        const message = err instanceof Error ? err.message : String(err)
        if (message === "RATE_LIMITED") {
          enterRateLimitedCooldown(value)
          return
        }
        setState({ kind: "error", value, message })
      }
    },
    [enterRateLimitedCooldown],
  )

  if (session.status !== "signed-in") return null

  const currentName = session.identity.displayName
  const value = inputValue(state, currentName)
  const status = describeStatus(state, currentName)
  const saveDisabled = state.kind !== "available"
  const resetDisabled = state.kind === "submitting" || state.kind === "rateLimited"
  const inputDisabled = state.kind === "submitting" || state.kind === "rateLimited"

  const onChange = (next: string) => {
    clearDebounce()
    clearSavedTimer()
    requestTokenRef.current += 1
    if (next === currentName) {
      setState({ kind: "idle" })
      return
    }
    setState({ kind: "typing", value: next })
    const token = requestTokenRef.current
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      setState({ kind: "checking", value: next })
      void runAvailability(next, token)
    }, DEBOUNCE_MS)
  }

  const onSave = async () => {
    if (state.kind !== "available") return
    const next = state.value
    clearDebounce()
    requestTokenRef.current += 1
    setState({ kind: "submitting", value: next })
    try {
      const res = await putNickname(next)
      session.updateDisplayName(res.displayName)
      setState({ kind: "saved", value: res.displayName })
      clearSavedTimer()
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null
        setState({ kind: "idle" })
      }, SAVED_FLASH_MS)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === "NICKNAME_TAKEN") {
        setState({ kind: "taken", value: next })
        return
      }
      if (message === "INVALID_FORMAT") {
        setState({ kind: "invalid", value: next })
        return
      }
      if (message === "RATE_LIMITED") {
        enterRateLimitedCooldown(next)
        return
      }
      setState({ kind: "error", value: next, message })
    }
  }

  const onReset = async () => {
    clearDebounce()
    requestTokenRef.current += 1
    setState({ kind: "submitting", value: currentName })
    try {
      const res = await deleteNickname()
      session.updateDisplayName(res.displayName)
      setState({ kind: "saved", value: res.displayName })
      clearSavedTimer()
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null
        setState({ kind: "idle" })
      }, SAVED_FLASH_MS)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === "RATE_LIMITED") {
        enterRateLimitedCooldown(currentName)
        return
      }
      setState({ kind: "error", value: currentName, message })
    }
  }

  return (
    <div
      data-state={state.kind}
      className="space-y-3 rounded-lg border border-unison-border bg-unison-bg-elevated p-4"
    >
      <div className="space-y-1">
        <label htmlFor="nickname-input" className="text-[10px] uppercase tracking-wider text-unison-text-muted">
          Nickname
        </label>
        <input
          id="nickname-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={inputDisabled}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-unison-border bg-unison-bg px-3 py-2 text-sm text-unison-text focus:border-unison-border-strong focus:outline-none disabled:opacity-60"
        />
      </div>
      {status ? (
        <p
          data-testid="nickname-status"
          className={`text-xs ${status.tone === "warn" ? "text-unison-warn" : "text-unison-text-muted"}`}
        >
          {status.text}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className="cursor-pointer rounded-md bg-unison-bg-hover px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-unison-text-secondary transition-colors hover:bg-unison-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to default
        </button>
      </div>
    </div>
  )
}
