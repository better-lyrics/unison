const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const tokenMs = (name: string, fallback: number) => Number.parseFloat(token(name)) || fallback

export const tokenValue = (name: string, fallback: string) => token(name) || fallback
