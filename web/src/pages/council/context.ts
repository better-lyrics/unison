import { useOutletContext } from "react-router-dom"

export interface CouncilContext {
  meKeyId: string
}

export function useCouncilContext(): CouncilContext {
  return useOutletContext<CouncilContext>()
}
