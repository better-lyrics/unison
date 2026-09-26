import { AVATAR_PRESETS, insertPreset } from "@/db/avatar-presets"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill-avatar-presets")

export async function backfillAvatarPresets(env: Env): Promise<{ seeded: number }> {
	let seeded = 0
	for (const preset of AVATAR_PRESETS) {
		if ((await insertPreset(env, preset)) === "inserted") seeded++
	}
	log.info("avatar preset backfill complete", { seeded })
	return { seeded }
}
