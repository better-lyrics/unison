import type { Env, PublicKeyRecord } from "@/types"

export async function getPublicKey(
	env: Env,
	keyId: string
): Promise<PublicKeyRecord | null> {
	return env.DB.prepare("SELECT * FROM public_keys WHERE key_id = ?")
		.bind(keyId)
		.first<PublicKeyRecord>()
}

export async function registerPublicKey(
	env: Env,
	keyId: string,
	publicKey: JsonWebKey
): Promise<PublicKeyRecord> {
	// Use ON CONFLICT to handle concurrent registration attempts gracefully
	await env.DB.prepare(
		"INSERT INTO public_keys (key_id, public_key) VALUES (?, ?) ON CONFLICT(key_id) DO NOTHING"
	)
		.bind(keyId, JSON.stringify(publicKey))
		.run()

	// Fetch the record (either just inserted or already existed)
	const result = await getPublicKey(env, keyId)
	return result!
}
