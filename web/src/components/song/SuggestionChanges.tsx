import { type DiffMode, DiffView } from "@/components/DiffView"
import { SongThumbnail } from "@/components/SongThumbnail"
import { UserAvatar } from "@/components/UserAvatar"
import { ActionBar, type ActionLayout, ConfirmStep, StepAnchor } from "@/components/council/ActionBar"
import { CouncilOverlay } from "@/components/council/CouncilOverlay"
import { Segmented } from "@/components/council/Segmented"
import { BlockHead, Callout } from "@/components/council/detail-parts"
import { Bone } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { useRevisionDiff } from "@/hooks/useLyricsData"
import { useSuggestionDecision, useWithdrawSuggestion } from "@/hooks/useSuggestionMutations"
import { cn } from "@/lib/cn"
import { formatElapsed, titleCase } from "@/lib/format"
import { type PreviewActions, REJECT_NOTE_MAX, type SuggestionContent, contentOf } from "@/lib/lyric-suggestion"
import type { SuggestionInboxItem } from "@/lib/revision-types"
import type { RevisionSuggestion } from "@/lib/types"
import { IconArrowBackUp, IconCheck, IconEye, IconInfoCircle } from "@tabler/icons-react"
import { useRef, useState } from "react"
import { Link } from "react-router-dom"

const DELETED_ACCOUNT = "a deleted account"

export function authorName(suggestion: RevisionSuggestion, at: "start" | "mid"): string {
  if (suggestion.author) return suggestion.author.displayName
  return at === "start" ? titleCase(DELETED_ACCOUNT) : DELETED_ACCOUNT
}

export const NOT_LOADED_HINT = "The suggestion did not load. Reload the page to try again."

export const WITHDRAW_TITLE = "Withdraw your suggestion?"

export const withdrawBody = (ownerless: boolean) =>
  ownerless
    ? "The council will no longer see it. You can send a new one after."
    : "The owner and the council will no longer see it. You can send a new one after."

export function suggestionPreviewPath(item: Pick<SuggestionInboxItem, "videoId" | "lyricsId">, revisionId: number) {
  const params = new URLSearchParams({ variantId: String(item.lyricsId), suggestion: String(revisionId) })
  return `/song/${encodeURIComponent(item.videoId)}?${params}`
}

export function SuggestionAuthor({ suggestion, className }: { suggestion: RevisionSuggestion; className: string }) {
  if (!suggestion.authorKeyId) return null
  return (
    <UserAvatar
      keyId={suggestion.authorKeyId}
      avatarUrl={suggestion.authorAvatarUrl}
      className={cn(
        "shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10",
        className,
      )}
    />
  )
}

export function SuggestionNote({ note }: { note: string }) {
  return (
    <q className="block text-[13.5px] leading-normal text-unison-text-secondary text-pretty [quotes:'\201C'_'\201D']">
      {note}
    </q>
  )
}

export function hasDecision(actions: PreviewActions): boolean {
  return actions.withdraw || actions.reject || actions.approve !== "hidden"
}

export function SuggestionDecision({
  item,
  actions,
  ownerless = false,
  layout = "inline",
  onDone,
}: {
  item: SuggestionInboxItem
  actions: PreviewActions
  ownerless?: boolean
  layout?: Exclude<ActionLayout, "bar">
  onDone?: () => void
}) {
  const decision = useSuggestionDecision(item.suggestion.id)
  const withdraw = useWithdrawSuggestion(item, item.suggestion.id)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)
  const withdrawRef = useRef<HTMLButtonElement>(null)
  const { suggestion } = item
  if (actions.withdraw) {
    const anchored = layout === "anchored"
    const cancelWithdraw = () => {
      if (anchored) withdrawRef.current?.focus()
      setConfirmingWithdraw(false)
    }
    const confirm = (
      <ConfirmStep
        title={WITHDRAW_TITLE}
        body={withdrawBody(ownerless)}
        label="Withdraw suggestion"
        icon={IconArrowBackUp}
        busy={withdraw.isPending}
        animate={!anchored}
        onConfirm={() => withdraw.mutate(undefined, { onSuccess: onDone })}
        onCancel={cancelWithdraw}
      />
    )
    const trigger = (
      <button
        ref={withdrawRef}
        type="button"
        aria-expanded={anchored ? confirmingWithdraw : undefined}
        className={cn(buttonClass("fill", "sm"), "aria-expanded:bg-white/[0.12]")}
        onClick={() => setConfirmingWithdraw(!confirmingWithdraw)}
      >
        <IconArrowBackUp aria-hidden className="size-3.5" stroke={1.75} />
        Withdraw suggestion
      </button>
    )
    if (anchored) {
      return (
        <>
          {trigger}
          <StepAnchor
            open={confirmingWithdraw}
            trigger={withdrawRef}
            label={WITHDRAW_TITLE}
            step={confirm}
            onDismiss={() => setConfirmingWithdraw(false)}
            onEscape={cancelWithdraw}
          />
        </>
      )
    }
    return confirmingWithdraw ? confirm : trigger
  }
  if (!actions.reject && actions.approve === "hidden") return null
  const by = authorName(suggestion, "mid")
  const notLoaded = actions.approve === "not-loaded"
  const loading = actions.approve === "loading"
  return (
    <ActionBar
      layout={layout}
      primary={{
        label: "Approve",
        icon: IconCheck,
        shortcut: "A",
        confirmTitle: `Approve Rev ${suggestion.revNo}?`,
        confirmBody: `It goes live for every listener right away, and ${by} gets the credit as its author.`,
        confirmLabel: `Approve Rev ${suggestion.revNo}`,
        unavailable: actions.approve === "available" || loading ? null : notLoaded ? "Approve" : "Council decides",
        unavailableHint: notLoaded ? NOT_LOADED_HINT : "The council decides this one. You can still reject it.",
      }}
      onPrimary={() => decision.mutate({ kind: "approve", item }, { onSuccess: onDone })}
      reject={{
        submitLabel: "Reject suggestion",
        hint: `${authorName(suggestion, "start")} sees this note with the rejected suggestion.`,
        noteLabel: `Note for ${by} (optional)`,
        noteMax: REJECT_NOTE_MAX,
        placeholder: "For example: the second verse timing was already right",
        unavailable: notLoaded ? NOT_LOADED_HINT : null,
        submitVariant: "destructive",
      }}
      onReject={(note) => decision.mutate({ kind: "reject", item, note }, { onSuccess: onDone })}
      busy={decision.isPending || loading}
    />
  )
}

export function SuggestionChangesDialog({
  item,
  actionsFor,
  now,
  previewPath,
  ownerless,
  open,
  onClose,
  onDone,
}: {
  item: SuggestionInboxItem
  actionsFor: (content: SuggestionContent) => PreviewActions
  now: number
  previewPath?: string
  ownerless?: boolean
  open: boolean
  onClose: () => void
  onDone?: () => void
}) {
  const { suggestion } = item
  const diff = useRevisionDiff(item.lyricsId, suggestion.id)
  const actions = actionsFor(contentOf(diff))
  const [mode, setMode] = useState<DiffMode>("unified")
  const by = authorName(suggestion, "start")

  return (
    <CouncilOverlay
      open={open}
      onOpenChange={(value) => (value ? null : onClose())}
      label={`Changes in ${authorName(suggestion, "mid")}'s suggestion`}
      className="top-1/2 w-[min(760px,calc(100vw-32px))] -translate-y-1/2"
    >
      <div className="flex max-h-[calc(100dvh-64px)] flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto overscroll-contain p-7">
          <div className="flex items-start gap-5">
            <SongThumbnail
              videoId={item.videoId}
              song={item.song}
              artist={item.artist}
              className="size-[88px] rounded-xl outline outline-1 -outline-offset-1 outline-white/10"
            />
            <div className="min-w-0">
              <h2 className="text-2xl leading-[1.2] font-bold tracking-[-0.01em] text-balance">{item.song}</h2>
              <p className="mt-1 text-sm text-unison-text-secondary">{item.artist}</p>
              {previewPath ? (
                <Link
                  to={previewPath}
                  className="mt-3.5 inline-flex items-center gap-[5px] text-xs text-unison-text-muted transition-colors hover:text-unison-text"
                >
                  <IconEye aria-hidden className="size-3" stroke={1.5} />
                  Preview on song page
                </Link>
              ) : null}
            </div>
          </div>
          <div>
            <BlockHead title="Suggested by" />
            <div className="flex items-center gap-3">
              <SuggestionAuthor suggestion={suggestion} className="size-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{by}</p>
                <p className="mt-[3px] text-xs text-unison-text-muted">
                  {`Suggested Rev ${suggestion.revNo}, ${formatElapsed(now - suggestion.createdAt)} ago`}
                </p>
              </div>
            </div>
            {suggestion.note ? (
              <div className="mt-3">
                <SuggestionNote note={suggestion.note} />
              </div>
            ) : null}
          </div>
          <div>
            <BlockHead
              title="Changes"
              aside={
                <Segmented
                  label="Diff layout"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "unified", label: "Unified" },
                    { value: "split", label: "Split" },
                  ]}
                />
              }
            />
            {diff.isError ? (
              <p className="text-[13px] text-unison-text-muted">Could not load the changes. Try again.</p>
            ) : diff.data ? (
              <DiffView rows={diff.data.rows} mode={mode} />
            ) : (
              <Bone className="h-40 w-full rounded-[10px]" />
            )}
          </div>
          {actions.approve === "available" ? (
            <Callout icon={<IconInfoCircle aria-hidden className="mt-0.5 size-4 shrink-0 opacity-50" stroke={1.5} />}>
              <b>{`Approving makes Rev ${suggestion.revNo} live for every listener.`}</b>
              {` ${by} gets the credit as its author.`}
            </Callout>
          ) : null}
        </div>
        {hasDecision(actions) ? (
          <div className="flex justify-end bg-[#141318] px-7 py-3.5 [&>div]:flex-1">
            <SuggestionDecision item={item} actions={actions} ownerless={ownerless} onDone={onDone ?? onClose} />
          </div>
        ) : null}
      </div>
    </CouncilOverlay>
  )
}
