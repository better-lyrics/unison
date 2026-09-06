import { cn } from "@/lib/cn"

const shimmer = "animate-pulse bg-white/[0.04] motion-reduce:animate-none"

function Block({ className }: { className?: string }) {
  return <div className={cn(shimmer, "rounded-md", className)} />
}

// A collapsed collapsible-section header: chevron, title, and an optional right-aligned summary.
function SectionHeaderSkeleton({ summary }: { summary?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Block className="size-4" />
        <Block className="h-5 w-28" />
      </div>
      {summary ? <Block className="ml-auto h-3 w-40" /> : null}
    </div>
  )
}

// Badges default to collapsed, so their loading state is just the section header.
export function BadgesSkeleton() {
  return <SectionHeaderSkeleton summary />
}

export function ProfileSkeleton() {
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

      <div className="mt-12 space-y-12">
        <SectionHeaderSkeleton summary />
        <SectionHeaderSkeleton />
        <SectionHeaderSkeleton />
      </div>
    </div>
  )
}
