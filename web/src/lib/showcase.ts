import apps from "./showcase.json"

export interface ShowcaseApp {
  name: string
  description: string
  url: string
  icon?: string
  iconFillsTile?: boolean
  featured?: boolean
  platforms: string[]
}

export const SHOWCASE_SUBMIT_URL = "https://github.com/better-lyrics/unison/issues/new?template=showcase.yml"

export const SHOWCASE_APPS: ShowcaseApp[] = apps
