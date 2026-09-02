import { useSession } from "@/auth/useSession"
import { MigrateView, type MigrateViewModel } from "@/components/MigrateView"
import { useDiscordLink } from "@/hooks/useDiscordLink"
import { useSearchParams } from "react-router-dom"

export function MigratePage() {
  const [params] = useSearchParams()
  const status = params.get("status")
  const sessionId = params.get("session")
  const session = useSession()
  const link = useDiscordLink({ enabled: false })

  if (status) {
    const name = params.get("name")
    const model: MigrateViewModel =
      status === "ready"
        ? { kind: "ready", name }
        : status === "same_key"
          ? { kind: "same_key" }
          : status === "expired"
            ? { kind: "expired" }
            : { kind: "error" }
    return <MigrateView model={model} />
  }

  if (!sessionId) {
    return <MigrateView model={{ kind: "start" }} />
  }

  if (session.status === "loading") {
    return <MigrateView model={{ kind: "loading" }} />
  }

  if (!session.extensionAvailable) {
    return <MigrateView model={{ kind: "install" }} />
  }

  return (
    <MigrateView model={{ kind: "prove", connecting: link.connecting, error: link.error, onConnect: link.connect }} />
  )
}
