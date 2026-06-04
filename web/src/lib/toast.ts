import { useSyncExternalStore } from "react"

export type ToastKind = "info" | "error" | "success"

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

export interface PushToastInput {
  kind: ToastKind
  message: string
  durationMs?: number
}

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  info: 3000,
  success: 3000,
  error: 5000,
}

let toasts: Toast[] = []
let counter = 0
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Toast[] {
  return toasts
}

function nextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  counter += 1
  return `toast-${Date.now()}-${counter}`
}

export function pushToast(input: PushToastInput): string {
  const id = nextId()
  const toast: Toast = { id, kind: input.kind, message: input.message }
  toasts = [...toasts, toast]
  emit()
  const duration = input.durationMs ?? DEFAULT_DURATIONS[input.kind]
  if (duration > 0) {
    const handle = setTimeout(() => {
      timers.delete(id)
      dismissToast(id)
    }, duration)
    timers.set(id, handle)
  }
  return id
}

export function dismissToast(id: string): void {
  const handle = timers.get(id)
  if (handle !== undefined) {
    clearTimeout(handle)
    timers.delete(id)
  }
  const next = toasts.filter((t) => t.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function __resetToastStore(): void {
  for (const handle of timers.values()) clearTimeout(handle)
  timers.clear()
  toasts = []
  counter = 0
  emit()
}
