export function sharedInFlight<T>() {
	const running = new Map<string, Promise<T>>()
	return (key: string, load: () => Promise<T>): Promise<T> => {
		const pending = running.get(key)
		if (pending) return pending
		const next = load().finally(() => running.delete(key))
		running.set(key, next)
		return next
	}
}
