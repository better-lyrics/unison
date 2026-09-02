import { LogoPair } from "@/components/LogoPair"
import type { ReactNode } from "react"

export function AuthFlowLayout({
  partner,
  pulsing = false,
  children,
}: {
  partner: ReactNode
  pulsing?: boolean
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 py-10 text-center">
      <LogoPair partner={partner} pulsing={pulsing} />
      {children}
    </div>
  )
}

export function AuthFlowTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-semibold text-unison-text">{children}</h1>
}

export function AuthFlowBody({ children }: { children: ReactNode }) {
  return <p className="max-w-sm text-sm leading-relaxed text-unison-text-secondary">{children}</p>
}

export function AuthFlowError({ children }: { children: ReactNode }) {
  return <p className="max-w-sm text-sm text-red-400">{children}</p>
}
