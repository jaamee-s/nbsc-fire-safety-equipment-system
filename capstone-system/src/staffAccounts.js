/* =====================================================================
   staffAccounts.js — shared checks for creating inspector / technician
   logins from the web app (see migrations 005 and 006).
   ===================================================================== */

// Shown under every Username field so the admin knows what to type.
export const USERNAME_HINT =
  'This is what they type in the mobile app to sign in. Use a short name like kenntech, or an email like kenntech@nbsc-fses.local.'

// Same rules the database enforces, checked first so the admin gets the
// message before anything is sent. A login with "@" is used as typed.
export function checkUsername(username) {
  const u = (username || '').trim().toLowerCase()
  if (!u) return 'Username is required.'
  if (u.includes('@')) {
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(u)) {
      return 'That email-style username is not complete. Example: kenntech@nbsc-fses.local'
    }
  } else if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
    return 'Use 3 to 30 letters or numbers, with no spaces. Example: kenntech'
  }
  return null
}

export function checkAccountFields(username, password) {
  const problem = checkUsername(username)
  if (problem) return problem
  if (!password) return 'Password is required.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

export function accountErrorMessage(error) {
  const msg = error?.message || String(error)
  if (/update_staff_account/i.test(msg)) {
    return 'Account settings are not set up in the database yet. Run migration 008_staff_account_settings.sql in the Supabase SQL Editor.'
  }
  if (/create_staff_account|list_staff_accounts|schema cache|does not exist/i.test(msg)) {
    return 'Account creation is not set up in the database yet. Run migration 005_staff_accounts_custom_types.sql in the Supabase SQL Editor.'
  }
  return msg
}
