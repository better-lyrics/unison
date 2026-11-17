export type NotificationGroup = "lyrics" | "suggestions"

export const NOTIFICATION_KINDS = {
	suggestion_new: { group: "lyrics", ref: "revision", dm: true },
	suggestion_deadline: { group: "lyrics", ref: "revision", dm: true },
	suggestion_council_decided: { group: "lyrics", ref: "revision", dm: false },
	suggestion_approved: { group: "suggestions", ref: "revision", dm: true },
	suggestion_rejected: { group: "suggestions", ref: "revision", dm: true },
} as const satisfies Record<string, { group: NotificationGroup; ref: "revision"; dm: boolean }>

export type NotificationKind = keyof typeof NOTIFICATION_KINDS

const kinds = Object.keys(NOTIFICATION_KINDS) as NotificationKind[]
export const REVISION_KINDS = kinds.filter((k) => NOTIFICATION_KINDS[k].ref === "revision")
export const DM_KINDS = kinds.filter((k) => NOTIFICATION_KINDS[k].dm)
export const WAITING_KINDS: NotificationKind[] = ["suggestion_new", "suggestion_deadline"]
