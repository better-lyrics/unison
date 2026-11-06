import { PROFILE_STAGE } from "@/components/profile/layout"
import { Bone } from "@/components/skeleton"
import { SubmissionsSkeleton } from "@/components/SubmissionsList"

export function ProfileSkeleton({ owner = false }: { owner?: boolean }) {
  return (
    <div>
      <section className={PROFILE_STAGE}>
        <Bone className="aspect-[5/7] w-full max-w-[400px] rounded-[28px]" />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="text-[40px] leading-[1.08] max-[1000px]:text-[30px]">
            <div className="flex h-[1.08em] items-center">
              <Bone className="h-[0.72em] w-4/5 rounded-xl" />
            </div>
            <div className="flex h-[1.08em] items-center">
              <Bone className="h-[0.72em] w-3/5 rounded-xl" />
            </div>
          </div>
          <div className="flex h-[21px] items-center">
            <Bone className="h-3 w-48" />
          </div>
          <div className="flex gap-2">
            {owner ? (
              <>
                <Bone className="h-[30px] w-[132px] rounded-[10px]" />
                <Bone className="h-[30px] w-[116px] rounded-[10px]" />
              </>
            ) : null}
            <Bone className="h-[30px] w-[79px] rounded-[10px]" />
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-14 pb-[108px]">
        <SubmissionsSkeleton />
      </div>
    </div>
  )
}
