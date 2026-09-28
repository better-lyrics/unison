import { TierChip } from "@/components/TierChip"
import { UserAvatar } from "@/components/UserAvatar"
import { Sparkline } from "@/components/charts/Sparkline"
import { PageHead } from "@/components/council/headings"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { buttonClass, tagClass } from "@/components/ui"
import { useBadgeImage } from "@/hooks/useBadgeImage"
import { useCouncilMembers, useCouncilRole } from "@/hooks/useCouncilData"
import { useAddMember, useRemoveMember } from "@/hooks/useCouncilMutations"
import { cn } from "@/lib/cn"
import { type RosterSort, isInactive, parseMemberInput, sortRoster } from "@/lib/council-roster"
import type { RosterMember } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"
import { IconChevronDown, IconClock, IconPlus, IconX } from "@tabler/icons-react"
import { type FormEvent, useId, useState } from "react"

export function CouncilMembersPage() {
  const now = Math.floor(Date.now() / 1000)
  const members = useCouncilMembers().data
  const admin = useCouncilRole()?.admin ?? false
  const [sort, setSort] = useState<RosterSort>("activity")
  const [adding, setAdding] = useState(false)
  const remove = useRemoveMember()
  const [confirming, setConfirming] = useState<string | null>(null)

  const header = (key: RosterSort, label: string) => (
    <th aria-sort={sort === key ? "descending" : "none"} className="px-4 pb-1 text-left font-medium">
      <button
        type="button"
        onClick={() => setSort(key)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-unison-text",
          sort === key && "text-unison-text",
        )}
      >
        {label}
        {sort === key ? <IconChevronDown aria-hidden className="size-3" stroke={1.5} /> : null}
      </button>
    </th>
  )

  return (
    <>
      <PageHead
        title="Members"
        sub={
          members
            ? `${members.length} council members. Quotas scale with leaderboard tier and reset on the 1st of each month.`
            : "Quotas scale with leaderboard tier and reset on the 1st of each month."
        }
        actions={
          admin && !adding ? (
            <button type="button" className={buttonClass("fill")} onClick={() => setAdding(true)}>
              <IconPlus aria-hidden className="size-3.5" stroke={1.75} />
              Add member
            </button>
          ) : null
        }
      />
      {admin && adding ? <AddMemberForm onDone={() => setAdding(false)} /> : null}
      {members ? (
        <table className="w-full border-separate border-spacing-x-0 border-spacing-y-1.5 text-[13px]">
          <thead className="text-[11px] whitespace-nowrap text-unison-text-muted">
            <tr>
              <th className="px-4 pb-1 text-left font-medium">Member</th>
              <th className="px-4 pb-1 text-left font-medium">Tier</th>
              {header("seals", "Seals this month")}
              <th className="px-4 pb-1 text-right font-medium">Rejections</th>
              <th className="px-4 pb-1 text-right font-medium">Edits</th>
              {header("decisions", "Decisions, 8 weeks")}
              {header("activity", "Last active")}
              {admin ? (
                <th className="px-4 pb-1">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="[&_td]:bg-white/[0.02] [&_td]:px-4 [&_td]:py-3.5 [&_td:first-child]:rounded-l-lg [&_td:last-child]:rounded-r-lg [&_tr:hover_td]:bg-unison-bg-hover">
            {sortRoster(members, sort).map((m) => (
              <MemberRow
                key={m.keyId}
                member={m}
                now={now}
                admin={admin}
                confirming={confirming === m.keyId}
                removing={remove.isPending}
                onAskRemove={() => setConfirming(m.keyId)}
                onCancel={() => setConfirming(null)}
                onRemove={() => {
                  setConfirming(null)
                  remove.mutate(m)
                }}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col gap-1.5">
          {skeletonKeys("member", 5).map((key) => (
            <Bone key={key} className="h-[60px] w-full rounded-lg" />
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-unison-text-muted">
        The council badge stays after a member leaves. Membership changes appear in Activity.
      </p>
    </>
  )
}

function MemberRow({
  member,
  now,
  admin,
  confirming,
  removing,
  onAskRemove,
  onCancel,
  onRemove,
}: {
  member: RosterMember
  now: number
  admin: boolean
  confirming: boolean
  removing: boolean
  onAskRemove: () => void
  onCancel: () => void
  onRemove: () => void
}) {
  const decisions = member.weekly.reduce((a, b) => a + b, 0)
  const badgeImage = useBadgeImage()
  return (
    <tr>
      <td>
        <div className="flex items-center gap-2.5">
          <UserAvatar
            avatarUrl={member.avatarUrl}
            keyId={member.keyId}
            className="size-8 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
            loading="lazy"
          />
          <b className="font-medium">{member.displayName}</b>
          {member.isYou ? (
            <span className="rounded bg-unison-text px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-unison-bg">
              YOU
            </span>
          ) : null}
          {member.isAdmin ? <span className={tagClass}>Admin</span> : null}
        </div>
      </td>
      <td>
        {member.tier ? (
          <TierChip tier={member.tier} gemSrc={badgeImage(member.tier) ?? undefined} />
        ) : (
          <span className="text-unison-text-muted">Unranked</span>
        )}
      </td>
      <td>
        <div className="flex items-center gap-2.5">
          <span
            role="img"
            aria-label={`${member.quota.used} of ${member.quota.quota} seals used`}
            className="flex gap-0.5"
          >
            {skeletonKeys("pip", member.quota.quota).map((key, i) => (
              <i
                key={key}
                className={cn(
                  "h-1.5 w-2.5 rounded-[2px]",
                  i < member.quota.used ? "bg-unison-medal-gold" : "bg-white/10",
                )}
              />
            ))}
          </span>
          <span className="font-mono text-[11px] text-unison-text-muted">
            {member.quota.used}/{member.quota.quota}
          </span>
        </div>
      </td>
      <td className="text-right font-mono">{member.rejectsThisMonth}</td>
      <td className="text-right font-mono">{member.editsThisMonth}</td>
      <td>
        <Sparkline values={member.weekly} label={`${decisions} decisions in 8 weeks`} />
      </td>
      <td>
        {isInactive(member, now) ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-unison-warn">
            <IconClock aria-hidden className="size-3" stroke={1.5} />
            {member.lastActiveAt === null ? "No activity yet" : `Inactive ${formatElapsed(now - member.lastActiveAt)}`}
          </span>
        ) : (
          <span className="font-mono text-xs text-unison-text-muted">
            {member.lastActiveAt === null ? "" : `${formatElapsed(now - member.lastActiveAt)} ago`}
          </span>
        )}
      </td>
      {admin ? (
        <td className="text-right whitespace-nowrap">
          {member.isYou || member.isAdmin ? null : confirming ? (
            <span className="inline-flex items-center gap-1.5">
              <button type="button" className={buttonClass("ghost", "sm")} onClick={onCancel}>
                Cancel
              </button>
              <button type="button" disabled={removing} className={buttonClass("danger", "sm")} onClick={onRemove}>
                Remove {member.displayName}
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Remove ${member.displayName} from the council`}
              className="grid size-7 cursor-pointer place-items-center rounded-md text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
              onClick={onAskRemove}
            >
              <IconX aria-hidden className="size-4" stroke={1.5} />
            </button>
          )}
        </td>
      ) : null}
    </tr>
  )
}

function AddMemberForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const add = useAddMember()
  const inputId = useId()
  const errorId = useId()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const input = parseMemberInput(value)
    if (!input) {
      setError("Enter a handle or a 64 character key id.")
      return
    }
    setError(null)
    add.mutate(input, { onSuccess: onDone })
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 flex flex-wrap items-start gap-2 rounded-xl bg-white/[0.02] p-4 shadow-inset-rim"
    >
      <div className="min-w-64 flex-1">
        <label htmlFor={inputId} className="mb-1.5 block text-xs text-unison-text-muted">
          Handle or key id
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          placeholder="@susiisthebest"
          autoComplete="off"
          className="h-8 w-full rounded-md border border-unison-border bg-unison-bg-elevated px-2.5 text-[13px] outline-none transition-colors hover:border-unison-border-strong focus:border-unison-border-strong"
        />
        {error ? (
          <p id={errorId} className="mt-1.5 text-xs text-unison-warn">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2 pt-[22px]">
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={add.isPending} className={buttonClass("primary", "sm")}>
          Add to council
        </button>
      </div>
    </form>
  )
}
