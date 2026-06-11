import { authedFetch } from "@/lib/authedFetch"

export interface AvailabilityResponse {
  available: boolean
  reason?: "INVALID_FORMAT" | "TAKEN" | "SELF"
}

export interface NicknameMutationResponse {
  keyId: string
  displayName: string
}

export async function checkNicknameAvailability(nickname: string): Promise<AvailabilityResponse> {
  return authedFetch<AvailabilityResponse>("/auth/nickname/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  })
}

export async function putNickname(nickname: string): Promise<NicknameMutationResponse> {
  return authedFetch<NicknameMutationResponse>("/auth/nickname", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  })
}

export async function deleteNickname(): Promise<NicknameMutationResponse> {
  return authedFetch<NicknameMutationResponse>("/auth/nickname", { method: "DELETE" })
}
