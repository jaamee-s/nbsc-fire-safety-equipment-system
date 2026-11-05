import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'

import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Phone notifications.
//
// The database creates a `notifications` row for every event (new job order,
// job closed, unit back in service...) and pushes it to the phone through
// Expo's push service — so it appears in the phone's notification tray even
// when the app is closed. See capstone-system/migrations/002_notifications_push.sql.
//
// Remote push needs an installed build of the app (EAS build). In Expo Go on
// Android it is not available, so while the app is open we fall back to a
// local notification built from the realtime row instead.
// ---------------------------------------------------------------------------

export const CHANNEL_ID = 'default'

// Show notifications as a banner with sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

async function ensureChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Fire safety alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2563EB'
  })
}

// Asks for permission (once) and registers this phone with the signed-in
// account. Returns the Expo push token, or null if push isn't available.
export async function registerForPush() {
  if (Platform.OS === 'web') return null
  try {
    // On Android 13+ the channel must exist before the permission prompt.
    await ensureChannel()

    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return null

    const projectId =
      Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    if (!token) return null

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS
    })
    if (error) {
      // Not saved, so the database can't push to this phone — return null so
      // the app falls back to showing notifications locally.
      console.warn('Could not save push token:', error.message)
      return null
    }
    return token
  } catch (err) {
    // Expected in Expo Go on Android, or with no signal. Local fallback still works.
    console.warn('Push notifications unavailable:', err?.message || err)
    return null
  }
}

// Called before signing out so the next person on this phone doesn't get
// the previous account's notifications.
export async function unregisterPush(token) {
  if (!token) return
  try {
    await supabase.rpc('unregister_push_token', { p_token: token })
  } catch (err) {
    console.warn('Could not remove push token:', err?.message || err)
  }
}

// Shows a notification on this phone right now (used when remote push
// isn't available, e.g. in Expo Go).
export async function showLocalNotification(title, body, data) {
  if (Platform.OS === 'web') return
  try {
    await ensureChannel()
    await Notifications.scheduleNotificationAsync({
      content: { title, body: body || '', data: data || {}, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null
    })
  } catch (err) {
    console.warn('Local notification failed:', err?.message || err)
  }
}

// Calls `onTap(data, id)` when the user taps a notification — including the
// one that opened the app from the tray. `id` lets the caller ignore a tap it
// has already handled.
export function onNotificationTap(onTap) {
  if (Platform.OS === 'web') return () => {}
  const handle = (response) => {
    const request = response?.notification?.request
    if (!request) return
    // Clear it once handled, so the same old tap isn't replayed the next
    // time the app opens or someone signs in.
    Notifications.clearLastNotificationResponseAsync().catch(() => {})
    onTap(request.content?.data || {}, request.identifier)
  }
  const sub = Notifications.addNotificationResponseReceivedListener(handle)
  Notifications.getLastNotificationResponseAsync()
    .then((response) => response && handle(response))
    .catch(() => {})
  return () => sub.remove()
}

// ---------------------------------------------------------------------------
// The notification history (rows from the `notifications` table).
// ---------------------------------------------------------------------------

export async function getMyNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, kind, action_id, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  // If the migration hasn't been run yet the table is missing — just show nothing.
  if (error) return []
  return data || []
}

export async function markNotificationsRead(ids) {
  if (!ids || ids.length === 0) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
}

// Live feed of new rows for this account. Returns an unsubscribe function.
export function subscribeToMyNotifications(userId, onInsert) {
  const channel = supabase
    .channel(`notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
