/* =====================================================================
   BackupPanel.jsx — "Download backup" on the Reports page (admins)

   Saves one JSON file with every FireScan table, read page by page (the
   database sends at most 1,000 rows per request). Keep these files
   somewhere safe (a USB drive, a shared drive) before and after going live.
   Staff passwords are never included: they are stored encrypted by
   Supabase and cannot be read.
   ===================================================================== */
import { useState } from 'react'
import { supabase } from './supabaseClient'

// Tables in the backup. A table that doesn't exist yet (migration not run)
// is skipped and listed in the file.
const TABLES = [
  'buildings',
  'building_locations',
  'equipment',
  'equipment_stock',
  'inspections',
  'maintenance_actions',
  'technicians',
  'inspection_assignments',
  'staff_unavailability',
  'staff_availability_changes',
  'job_order_requests',
  'purchase_requests',
  'purchase_request_items',
  'change_log'
]
const PAGE = 1000

async function readAll(table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

export default function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function download() {
    setBusy(true)
    setStatus('Reading the data...')
    const backup = { app: 'FireScan', created_at: new Date().toISOString(), tables: {}, skipped: [] }
    let total = 0
    for (const table of TABLES) {
      setStatus(`Reading ${table.replace(/_/g, ' ')}...`)
      try {
        backup.tables[table] = await readAll(table)
        total += backup.tables[table].length
      } catch (error) {
        backup.skipped.push({ table, reason: error.message })
      }
    }
    // The staff accounts list (names, roles, usernames), never passwords.
    const staff = await supabase.rpc('list_staff_accounts')
    if (!staff.error) backup.tables.staff_accounts = staff.data || []

    const stamp = backup.created_at.slice(0, 16).replace(/[:T]/g, '-')
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `firescan-backup-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    setStatus(
      `Saved firescan-backup-${stamp}.json: ${total.toLocaleString()} records from ${
        Object.keys(backup.tables).length
      } tables.` + (backup.skipped.length ? ` Skipped (not set up yet): ${backup.skipped.map((s) => s.table).join(', ')}.` : '')
    )
    setBusy(false)
  }

  return (
    <section className="panel backup-panel" aria-labelledby="backup-title">
      <div className="backup-head">
        <div>
          <h3 id="backup-title">Backup</h3>
          <p>
            Download a full copy of the FireScan data to this computer: equipment, inspections, repairs, staff list,
            leave dates, forms and the change log. Passwords are never included.
          </p>
        </div>
        <button className="btn btn-primary" onClick={download} disabled={busy}>
          {busy ? 'Preparing...' : 'Download backup'}
        </button>
      </div>
      {status && <p className="backup-status">{status}</p>}
      <details className="backup-guide">
        <summary>How to keep the data safe</summary>
        <ol>
          <li>Download a backup before adding the GSO&apos;s real data, then once a week, and before any big change.</li>
          <li>Keep the files in two places, for example a USB drive and the GSO&apos;s shared drive.</li>
          <li>
            In the Supabase dashboard, open <b>Database → Backups</b> to see what the current plan keeps. Automatic daily
            backups come with Supabase&apos;s paid plan; on the free plan, these downloads are your backup.
          </li>
          <li>A free Supabase project is paused after a long time without use. Open the system at least once a week.</li>
        </ol>
      </details>
    </section>
  )
}
