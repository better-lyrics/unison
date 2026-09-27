import type { RosterMember } from "./council-types"

export type RosterSort = "activity" | "decisions" | "seals"

const INACTIVE_AFTER_SEC = 14 * 86400

const total = (m: RosterMember) => m.weekly.reduce((a, b) => a + b, 0)

const SORTS: Record<RosterSort, (a: RosterMember, b: RosterMember) => number> = {
  activity: (a, b) => (b.lastActiveAt ?? -1) - (a.lastActiveAt ?? -1),
  decisions: (a, b) => total(b) - total(a),
  seals: (a, b) => b.quota.used - a.quota.used,
}

export function sortRoster(members: RosterMember[], sort: RosterSort): RosterMember[] {
  return [...members].sort(SORTS[sort])
}

export function isInactive(member: RosterMember, now: number): boolean {
  return member.lastActiveAt === null || now - member.lastActiveAt > INACTIVE_AFTER_SEC
}

export type MemberInput = { kind: "keyId" | "handle"; value: string }

export function parseMemberInput(input: string): MemberInput | null {
  const text = input.trim()
  if (/^[0-9a-f]{64}$/i.test(text)) return { kind: "keyId", value: text.toLowerCase() }
  const handle = text.replace(/^@/, "")
  return handle === "" ? null : { kind: "handle", value: handle }
}
