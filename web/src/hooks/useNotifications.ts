import {
  fetchNotificationSettings,
  fetchNotifications,
  fetchUnreadNotifications,
  markNotificationsSeen,
  putNotificationSettings,
} from "@/lib/api"
import type { NotificationList, NotificationSettings } from "@/lib/types"
import { useOptionalSession } from "@/auth/useSession"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const notificationKeys = {
  root: ["notifications"] as const,
  unread: (keyId: string | null) => ["notifications", keyId, "unread"] as const,
  list: (keyId: string | null) => ["notifications", keyId, "list"] as const,
  settings: (keyId: string | null) => ["notifications", keyId, "settings"] as const,
}

function useViewerKeyId(): string | null {
  const session = useOptionalSession()
  return session?.status === "signed-in" ? session.identity.keyId : null
}

export function useUnreadCount(enabled: boolean) {
  const keyId = useViewerKeyId()
  return useQuery({
    queryKey: notificationKeys.unread(keyId),
    queryFn: ({ signal }) => fetchUnreadNotifications(signal),
    enabled: enabled && keyId !== null,
    refetchOnWindowFocus: true,
  })
}

export function useNotificationList(enabled: boolean) {
  const keyId = useViewerKeyId()
  return useQuery({
    queryKey: notificationKeys.list(keyId),
    queryFn: ({ signal }) => fetchNotifications(signal),
    enabled: enabled && keyId !== null,
  })
}

export function useMarkSeen() {
  const client = useQueryClient()
  const keyId = useViewerKeyId()
  return useMutation({
    mutationFn: markNotificationsSeen,
    onSuccess: () => {
      client.setQueryData<{ unread: number }>(notificationKeys.unread(keyId), { unread: 0 })
      client.setQueryData<NotificationList>(notificationKeys.list(keyId), (list) =>
        list ? { unread: 0, items: list.items.map((item) => ({ ...item, unread: false })) } : list,
      )
    },
  })
}

export function useNotificationSettings(enabled: boolean) {
  const keyId = useViewerKeyId()
  return useQuery({
    queryKey: notificationKeys.settings(keyId),
    queryFn: ({ signal }) => fetchNotificationSettings(signal),
    enabled: enabled && keyId !== null,
  })
}

export function useSetNotificationSettings() {
  const client = useQueryClient()
  const keyId = useViewerKeyId()
  return useMutation({
    mutationFn: putNotificationSettings,
    onMutate: async (next: NotificationSettings) => {
      await client.cancelQueries({ queryKey: notificationKeys.settings(keyId) })
      const previous = client.getQueryData<NotificationSettings>(notificationKeys.settings(keyId))
      client.setQueryData(notificationKeys.settings(keyId), next)
      return { previous }
    },
    onError: (_, __, context) => {
      if (context?.previous) client.setQueryData(notificationKeys.settings(keyId), context.previous)
    },
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.settings(keyId) }),
  })
}
