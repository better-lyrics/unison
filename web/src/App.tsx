import { QueryProvider } from "./lib/queryClient"
import { AppRouter } from "./router"

export function App() {
  return (
    <QueryProvider>
      <AppRouter />
    </QueryProvider>
  )
}
