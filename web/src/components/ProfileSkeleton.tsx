import { cn } from "@/lib/cn"

const shimmer = "animate-pulse bg-white/[0.04] motion-reduce:animate-none"

function Block({ className }: { className?: string }) {
  return <div className={cn(shimmer, "rounded-md", className)} />
}

function CollapsedSectionSkeleton({
  titleWidth = "w-28",
  summary = false,
}: { titleWidth?: string; summary?: boolean }) {
  return (
    <div className="flex h-7 items-center gap-2">
      <Block className="size-4" />
      <Block className={cn("h-[18px]", titleWidth)} />
      {summary ? <Block className="ml-auto h-3 w-16" /> : null}
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
      <CollapsedSectionSkeleton titleWidth="w-32" summary />
      <CollapsedSectionSkeleton />
      <CollapsedSectionSkeleton />
      <CollapsedSectionSkeleton />
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
