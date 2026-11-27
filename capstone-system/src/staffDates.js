/* =====================================================================
   staffDates.js — inspectors' and technicians' unavailable dates
   ===================================================================== */

// Today's local calendar day as 'YYYY-MM-DD'.
function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The unavailable dates covering today for this person, or null. On those
// days they count as Unavailable, whatever their switch says.
// leaves: [{ profile_id, start_date, end_date, reason }]
export function leaveToday(leaves = [], profileId) {
  if (!profileId) return null
  const today = todayYmd()
  return leaves.find((l) => l.profile_id === profileId && l.start_date <= today && l.end_date >= today) || null
}
