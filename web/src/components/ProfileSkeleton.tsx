import { PROFILE_PAGE, PROFILE_STAGE } from "@/components/profile/layout"
import { Bone, skeletonKeys } from "@/components/skeleton"

export function ProfileSkeleton({ owner = false }: { owner?: boolean }) {
  return (
    <div className={PROFILE_PAGE}>
      <section className={PROFILE_STAGE}>
        <Bone className="aspect-[5/7] w-full max-w-[400px] rounded-[28px]" />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="space-y-2.5">
            <Bone className="h-10 w-4/5 rounded-xl max-[1000px]:h-8" />
            <Bone className="h-10 w-3/5 rounded-xl max-[1000px]:h-8" />
          </div>
          <Bone className="h-4 w-48" />
          <div className="flex gap-2">
            {owner ? (
              <>
                <Bone className="h-[30px] w-32 rounded-[10px]" />
                <Bone className="h-[30px] w-28 rounded-[10px]" />
              </>
            ) : null}
            <Bone className="h-[30px] w-20 rounded-[10px]" />
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-4">
        <Bone className="h-6 w-36" />
        <div className="grid grid-cols-4 gap-5 max-[1000px]:grid-cols-2 max-[1000px]:gap-4">
          {skeletonKeys("profile-tile", 4).map((key) => (
            <Bone key={key} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
