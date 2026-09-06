import { editableCardClass } from "@/components/ui"
import { cn } from "@/lib/cn"

const shimmer = "animate-pulse bg-white/[0.04] motion-reduce:animate-none"

function Block({ className }: { className?: string }) {
  return <div className={cn(shimmer, "rounded-md", className)} />
}

// Mirrors an OwnerControls LeaderboardSection: title + subtitle header, then a card.
function ControlSectionSkeleton({ card }: { card: string }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Block className="h-5 w-24" />
        <Block className="h-3 w-56" />
      </div>
      <Block className={cn("w-full rounded-lg", card)} />
    </div>
  )
}

// Reserves the owner's edit block so the sections below it don't shift when data resolves.
function OwnerBlockSkeleton() {
  return (
    <div className="mt-12 space-y-6">
      <div className="flex justify-end">
        <Block className="h-9 w-40 rounded-lg" />
      </div>
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-7 items-center gap-2">
            <Block className="size-4" />
            <Block className="h-[18px] w-32" />
          </div>
          <Block className="ml-auto h-3 w-16" />
        </div>
        <div className={cn(editableCardClass, "mt-5")}>
          <Block className="h-3 w-64" />
          <div className="flex flex-wrap gap-2">
            {["a", "b", "c", "d", "e", "f"].map((k) => (
              <Block key={k} className="size-[74px] rounded-lg" />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Block className="h-3 w-24" />
            <Block className="h-8 w-16 rounded-md" />
          </div>
        </div>
      </div>
      <ControlSectionSkeleton card="h-[168px]" />
      <ControlSectionSkeleton card="h-[124px]" />
    </div>
  )
}

export function ProfileSkeleton({ owner = false }: { owner?: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-5">
        <div className={cn(shimmer, "size-[92px] shrink-0 rounded-full")} />
        <div className="min-w-0 flex-1 pt-1">
          <Block className="h-[30px] w-56" />
          <div className="mt-3.5 flex gap-2.5">
            <Block className="h-7 w-28 rounded-full" />
            <Block className="h-7 w-20 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Block className="h-12 w-40 rounded-full" />
        <Block className="h-12 w-44 rounded-full" />
        <Block className="h-12 w-40 rounded-full" />
      </div>

      {owner ? <OwnerBlockSkeleton /> : null}
    </div>
  )
}
