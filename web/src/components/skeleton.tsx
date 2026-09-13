import { cn } from "@/lib/cn"

export const bone = "animate-pulse rounded-md bg-white/[0.04] motion-reduce:animate-none"

export function Bone({ className }: { className?: string }) {
	return <div aria-hidden="true" className={cn(bone, className)} />
}

export function skeletonKeys(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => `${prefix}-${i}`)
}
