import { useSearchParams } from "react-router-dom"
import { useSession } from "@/auth/useSession"
import { LinkView, type LinkViewModel } from "@/components/LinkView"
import { useDiscordLink } from "@/hooks/useDiscordLink"

export function LinkPage() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const outcome = params.get("status")
  const link = useDiscordLink({ enabled: !outcome })

  if (outcome) {
    const name = params.get("name")
    const onReset = () => setParams({})
    const model: LinkViewModel =
      outcome === "linked"
        ? { kind: "linked", name }
        : outcome === "blocked"
          ? { kind: "blocked" }
          : outcome === "expired"
            ? { kind: "expired", onReset }
            : { kind: "error", onReset }
    return <LinkView model={model} />
  }

  if (session.status === "loading") {
    return <LinkView model={{ kind: "loading" }} />
  }

  if (!session.extensionAvailable) {
    return <LinkView model={{ kind: "install" }} />
  }

  if (link.status === "linked") {
    return (
      <LinkView
        model={{
          kind: "existing",
          name: link.username,
          working: link.working,
          error: link.error,
          onDisconnect: link.disconnect,
        }}
      />
    )
  }

  return (
    <LinkView
      model={{ kind: "connect", connecting: link.connecting, error: link.error, onConnect: link.connect }}
    />
  )
}
