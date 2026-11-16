import {
  fetchNotificationSettings,
  fetchNotifications,
  fetchUnreadNotifications,
  markNotificationsSeen,
  putNotificationSettings,
} from "@/lib/api"
import type { NotificationList, NotificationSettings } from "@/lib/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export const notificationKeys = {
  root: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: ["notifications", "list"] as const,
  settings: ["notifications", "settings"] as const,
}

export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => fetchUnreadNotifications(signal),
    enabled,
    refetchOnWindowFocus: true,
  })
}

export function useNotificationList(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ signal }) => fetchNotifications(signal),
    enabled,
  })
}

export function useMarkSeen() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: markNotificationsSeen,
    onSuccess: () => {
      client.setQueryData<{ unread: number }>(notificationKeys.unread, { unread: 0 })
      client.setQueryData<NotificationList>(notificationKeys.list, (list) =>
        list ? { unread: 0, items: list.items.map((item) => ({ ...item, unread: false })) } : list,
      )
    },
  })
}

export function useNotificationSettings(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.settings,
    queryFn: ({ signal }) => fetchNotificationSettings(signal),
    enabled,
  })
}

export function useSetNotificationSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: putNotificationSettings,
    onMutate: async (next: NotificationSettings) => {
      await client.cancelQueries({ queryKey: notificationKeys.settings })
      const previous = client.getQueryData<NotificationSettings>(notificationKeys.settings)
      client.setQueryData(notificationKeys.settings, next)
      return { previous }
    },
    onError: (_, __, context) => {
      if (context?.previous) client.setQueryData(notificationKeys.settings, context.previous)
    },
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.settings }),
  })
}
