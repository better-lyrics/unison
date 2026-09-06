import { cn } from "@/lib/cn"
import { editableCardClass } from "@/components/ui"

const shimmer = "animate-pulse bg-white/[0.04] motion-reduce:animate-none"

function Block({ className }: { className?: string }) {
  return <div className={cn(shimmer, "rounded-md", className)} />
}

// Matches a CollapsibleSection header (28px row: chevron + title, optional right summary).
function SectionHeaderSkeleton({ summary, className }: { summary?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-7 items-center gap-2">
        <Block className="size-4" />
        <Block className="h-[18px] w-28" />
      </div>
      {summary ? <Block className="ml-auto h-3 w-40" /> : null}
    </div>
  )
}

function OwnerBlockSkeleton() {
  return (
    <div className="mt-12 space-y-6">
      <div className="flex justify-end">
        <Block className="h-9 w-40 rounded-lg" />
      </div>
      <div>
        <SectionHeaderSkeleton summary />
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
      <Block className="h-28 w-full rounded-lg" />
      <Block className="h-28 w-full rounded-lg" />
    </div>
  )
}

export function ProfileSkeleton({ owner = false }: { owner?: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-5">
        <div className={cn(shimmer, "size-[92px] shrink-0 rounded-full")} />
        <div className="min-w-0 flex-1 pt-1">
          <Block className="h-7 w-56" />
          <Block className="mt-3 h-4 w-44" />
          <div className="mt-4 flex gap-2.5">
            <Block className="h-7 w-28 rounded-full" />
            <Block className="h-7 w-20 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Block className="h-[50px] w-40 rounded-full" />
        <Block className="h-[50px] w-44 rounded-full" />
        <Block className="h-[50px] w-40 rounded-full" />
      </div>

      {owner ? <OwnerBlockSkeleton /> : null}

      <SectionHeaderSkeleton summary className="mt-12" />
      <SectionHeaderSkeleton className="mt-12" />
    </div>
  )
}
