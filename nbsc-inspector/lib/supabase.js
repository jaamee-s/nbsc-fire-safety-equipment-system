import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'

/**
 * This app has NO login, by design — the panel approved device-level access
 * control instead. So the client connects with the public anon key and never
 * holds a session.
 *
 * Because there is no authenticated user, RLS blocks all direct table writes.
 * Submissions go through the submit_inspector_inspection() function instead.
 */
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
)