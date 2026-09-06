import { cn } from "@/lib/cn"

const shimmer = "animate-pulse bg-white/[0.04] motion-reduce:animate-none"

function Block({ className }: { className?: string }) {
  return <div className={cn(shimmer, "rounded-md", className)} />
}

export function BadgesSkeleton() {
  const groups = ["group-a", "group-b"]
  const tiles = ["t0", "t1", "t2", "t3", "t4"]
  return (
    <div>
      <div className="mb-5 flex items-center gap-4">
        <Block className="h-5 w-24" />
        <Block className="ml-auto h-3 w-40" />
      </div>
      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-5 flex items-center gap-3">
              <Block className="h-3.5 w-16" />
              <span className="h-px flex-1 bg-unison-border" />
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-6">
              {tiles.map((t) => (
                <div key={`${g}-${t}`} className="w-[84px] text-center">
                  <div className={cn(shimmer, "mx-auto size-[60px] rounded-xl")} />
                  <Block className="mx-auto mt-2.5 h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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

      <div className="mt-12">
        <BadgesSkeleton />
      </div>
    </div>
  )
}
