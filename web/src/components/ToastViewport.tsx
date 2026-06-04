import { IconX } from "@tabler/icons-react"
import { cn } from "@/lib/cn"
import { type Toast, type ToastKind, dismissToast, useToasts } from "@/lib/toast"

const KIND_STYLES: Record<ToastKind, string> = {
  info: "border-unison-border bg-unison-bg-elevated text-unison-text",
  success: "border-green-500/40 bg-green-500/10 text-green-200",
  error: "border-amber-500/40 bg-amber-500/10 text-amber-200",
}

export function ToastViewport() {
  const toasts = useToasts()
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

interface ToastCardProps {
  toast: Toast
}

function ToastCard({ toast }: ToastCardProps) {
  return (
    <output
      data-toast-id={toast.id}
      data-toast-kind={toast.kind}
      className={cn(
        "pointer-events-auto flex min-w-[220px] max-w-sm items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-md",
        "transition duration-200 ease-out",
        KIND_STYLES[toast.kind],
      )}
    >
      <span className="flex-1 break-words">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-current opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-unison-border-strong"
      >
        <IconX size={14} aria-hidden />
      </button>
    </output>
  )
}
