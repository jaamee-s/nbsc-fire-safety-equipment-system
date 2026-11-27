/* =====================================================================
   reports.js — plain logic (no components) for the Reports page

   Every report is built the same way: pick the rows that match the filters,
   then turn them into a table (columns + rows of text). The same table is
   shown as the preview and printed, so what you see is what prints.

   Exports:
     REPORTS               the list shown in the Report dropdown
     defaultFilters        empty filters for a report
     buildReport           the table for one report and its filters
     buildInventoryReport  the Equipment Inventory table (also used by the
                           Print Report button on the Equipment page)
   ===================================================================== */

export const REPORTS = [
  { key: 'inventory', label: 'Equipment Inventory', description: 'Every unit, with its status, location and last inspection.' },
  { key: 'inspection', label: 'Inspection Report', description: 'Inspections done in a date range.' },
  { key: 'repairs', label: 'Technician Report', description: 'Reported defects and the job orders given to technicians, in a date range.' },
  { key: 'purchase', label: 'Purchase Requests Needed', description: 'Units that need a replacement that the storeroom stock cannot cover.' },
  { key: 'expiry', label: 'Expiring / Expired', description: 'Units past or near their expiration date.' },
  { key: 'summary', label: 'System Summary', description: 'Totals, requests needed, repairs, inspections and stock.' },
  { key: 'changes', label: 'Change Log', description: 'Every add, edit and delete made by an admin, with who did it and when.' }
]

// Change Log (migration 023): the GSO-managed tables, by the name people know.
export const CHANGE_AREAS = {
  equipment: 'Equipment',
  buildings: 'Buildings',
  building_locations: 'Floors and rooms',
  equipment_stock: 'Stock',
  technicians: 'Technicians',
  profiles: 'Staff accounts',
  maintenance_actions: 'Priority Actions / repairs',
  inspection_assignments: 'Inspection job orders',
  job_order_requests: 'Job Order Request forms',
  purchase_requests: 'Purchase Request forms',
  purchase_request_items: 'Purchase Request items'
}

// 'exact_location' -> 'Exact location'
const fieldName = (k) => k.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function changeValue(v) {
  if (v === null || v === undefined || v === '') return '(blank)'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 60 ? s.slice(0, 57) + '...' : s
}

// The fields an edit changed, in words: "Status: Defective → Functional".
export function describeChanges(entry) {
  if (entry.action !== 'edited') return entry.action === 'added' ? 'Added' : 'Deleted'
  return Object.entries(entry.changes || {})
    .map(([k, [a, b]]) => `${fieldName(k)}: ${changeValue(a)} → ${changeValue(b)}`)
    .join('; ')
}

export const ACTION_STATUS_LABELS = {
  pending: 'Needs Job Order',
  in_progress: 'In progress',
  delayed: 'Delayed',
  for_disposal: 'For disposal',
  unresolved: 'Unresolved',
  completed: 'Completed'
}

const RESULT_LABELS = { functional: 'Functional', defective: 'Defective', for_disposal: 'For disposal' }

// "Code typed" note for an inspection whose code was typed instead of
// scanned (migration 026), e.g. "Code typed (sticker damaged)".
export function typedNote(i) {
  return i?.entry_method === 'typed' ? `Code typed${i.typed_reason ? ` (${i.typed_reason.toLowerCase()})` : ''}` : ''
}
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

// Calendar day in the Philippines ('YYYY-MM-DD').
export function manilaDay(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

// Equipment covered by an inspection assignment: in-service units in that
// building (and on that floor, when one was picked). exact_location is saved
// as "<floor> - <room>". Units added after the assignment was made are not
// part of it. (A form not saved yet has no created_at: every unit counts.)
export function unitsForAssignment(a, equipment) {
  const madeAt = a.created_at ? new Date(a.created_at).getTime() : null
  return equipment.filter(
    (e) =>
      e.building_id === a.building_id &&
      e.current_status !== 'no_longer_in_service' &&
      (!a.floor_label || (e.exact_location || '').startsWith(`${a.floor_label} - `)) &&
      (madeAt === null || !e.created_at || new Date(e.created_at).getTime() <= madeAt)
  )
}

// The defect report (maintenance action) an inspection created: same unit,
// same day, the closest one in time. Only a defective inspection has one.
export function actionForInspection(i, actions) {
  if (i.condition_status !== 'defective') return null
  const day = manilaDay(i.inspection_date)
  const t = new Date(i.inspection_date).getTime()
  return (
    actions
      .filter((a) => a.equipment?.id === i.equipment_id && a.reported_date && manilaDay(a.reported_date) === day)
      .sort((a, b) => Math.abs(new Date(a.reported_date) - t) - Math.abs(new Date(b.reported_date) - t))[0] || null
  )
}

// Priority of one inspection, the same everywhere (Inspectors page history
// and the Inspection Report):
// - defective: the priority of the defect report it created
// - otherwise: the priority of the assignment it was done for, if any
export function inspectionPriority(i, { actions = [], assignments = [], equipment = [] }) {
  const action = actionForInspection(i, actions)
  if (action) return action.priority
  const unit = equipment.find((e) => e.id === i.equipment_id)
  if (!unit || !i.inspector_id) return null
  const t = new Date(i.inspection_date).getTime()
  const a = assignments
    .filter(
      (x) =>
        x.inspector_id === i.inspector_id &&
        new Date(x.created_at).getTime() <= t &&
        unitsForAssignment(x, [unit]).length === 1
    )
    .sort((x, y) => PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority])[0]
  return a ? a.priority : null
}
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

export function defaultFilters(key) {
  switch (key) {
    case 'inventory':
      return { type: '', status: '', building: '' }
    case 'inspection':
      return { from: '', to: '', inspector: '', status: '', priority: '', building: '' }
    case 'repairs':
      return { from: '', to: '', technician: '', status: '', priority: '' }
    case 'purchase':
      return { type: '', building: '' }
    case 'expiry':
      return { show: 'both', within: '30', type: '', building: '' }
    case 'changes':
      return { from: '', to: '', area: '', person: '' }
    default:
      return {}
  }
}

// Local calendar day of a timestamp, as 'YYYY-MM-DD' (compares as text).
// A bare 'YYYY-MM-DD' is returned as is, so it never shifts a day.
export function localYmd(value) {
  if (!value) return ''
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (isNaN(d)) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function inRange(value, from, to) {
  const day = localYmd(value)
  if (from && (!day || day < from)) return false
  if (to && (!day || day > to)) return false
  return true
}

// inspections.inspector_name may be stored as "Name" or "Name (inspector)".
export function cleanInspectorName(name) {
  return (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Not recorded'
}

function rangeText(from, to, fmt) {
  if (!from && !to) return 'All dates'
  if (from && to) return `${fmt(from)} to ${fmt(to)}`
  return from ? `From ${fmt(from)}` : `Up to ${fmt(to)}`
}

/* ------------------------------------------------------------------ */

// ctx: { typeLabel, statusLabel, formatTimestamp, buildings, inspectionsByEquipment }
export function buildInventoryReport(items, filterText, ctx) {
  return {
    title: 'Fire Safety Equipment Report',
    filterText,
    columns: ['#', 'Code', 'Type', 'Building', 'Location', 'Status', 'Installed', 'Expires', 'Last inspection'],
    rows: items.map((item, i) => {
      const last = (ctx.inspectionsByEquipment[item.id] || [])[0]
      return [
        String(i + 1),
        item.equipment_code,
        ctx.typeLabel(item.equipment_type),
        item.buildings?.building_name ?? '—',
        item.exact_location || '—',
        ctx.statusLabel(item.current_status),
        item.installation_date ? ctx.formatTimestamp(item.installation_date) : '—',
        item.expiration_date ? ctx.formatTimestamp(item.expiration_date) : '—',
        last ? ctx.formatTimestamp(last.inspection_date) : 'Never inspected'
      ]
    }),
    total: items.length,
    unit: 'unit'
  }
}

function buildingName(ctx, id) {
  return id ? ctx.buildings.find((b) => b.id === id)?.building_name || '—' : 'All buildings'
}

// data: { equipment, inspections, actions, technicians, purchaseItems, assignments }
export function buildReport(key, f, data, ctx) {
  const fmtDay = (ymd) => ctx.formatTimestamp(ymd)
  const equipmentById = {}
  data.equipment.forEach((e) => {
    equipmentById[e.id] = e
  })

  if (key === 'inventory') {
    const items = data.equipment.filter(
      (e) =>
        (!f.type || e.equipment_type === f.type) &&
        (!f.building || e.building_id === f.building) &&
        (!f.status ||
          (f.status === '__needs_attention__'
            ? e.current_status !== 'functional' && e.current_status !== 'no_longer_in_service'
            : e.current_status === f.status))
    )
    return buildInventoryReport(
      items,
      [
        ['Type', f.type ? ctx.typeLabel(f.type) : 'All types'],
        ['Status', f.status === '__needs_attention__' ? 'Needs attention' : f.status ? ctx.statusLabel(f.status) : 'All statuses'],
        ['Building', buildingName(ctx, f.building)]
      ],
      ctx
    )
  }

  if (key === 'inspection') {
    // Priority of each inspection, decided the same way as on the
    // Inspectors page (see inspectionPriority).
    const prioCtx = { actions: data.actions, assignments: data.assignments || [], equipment: data.equipment }
    const items = data.inspections
      .map((i) => ({ ...i, priority: inspectionPriority(i, prioCtx) }))
      .filter((i) => {
        const e = equipmentById[i.equipment_id]
        return (
          inRange(i.inspection_date, f.from, f.to) &&
          (!f.inspector || cleanInspectorName(i.inspector_name) === f.inspector) &&
          (!f.status || i.condition_status === f.status) &&
          (!f.priority || (f.priority === '__none__' ? !i.priority : i.priority === f.priority)) &&
          (!f.building || e?.building_id === f.building)
        )
      })
      .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date))
    return {
      title: 'Inspection Report',
      filterText: [
        ['Dates', rangeText(f.from, f.to, fmtDay)],
        ['Inspector', f.inspector || 'All inspectors'],
        ['Status', f.status ? RESULT_LABELS[f.status] : 'All statuses'],
        ['Priority', f.priority === '__none__' ? 'No priority' : f.priority ? cap(f.priority) : 'All priorities'],
        ['Building', buildingName(ctx, f.building)]
      ],
      columns: ['#', 'Date and time', 'Code', 'Type', 'Building', 'Inspector', 'Status', 'Priority', 'Findings'],
      rows: items.map((i, n) => {
        const e = equipmentById[i.equipment_id]
        return [
          String(n + 1),
          ctx.formatTimestamp(i.inspection_date),
          e?.equipment_code || '—',
          e ? ctx.typeLabel(e.equipment_type) : '—',
          e?.buildings?.building_name ?? '—',
          cleanInspectorName(i.inspector_name),
          RESULT_LABELS[i.condition_status] || i.condition_status,
          i.priority ? cap(i.priority) : '—',
          [i.findings, typedNote(i)].filter(Boolean).join(' · ') || '—'
        ]
      }),
      total: items.length,
      unit: 'inspection'
    }
  }

  if (key === 'repairs') {
    const techName = (id) => data.technicians.find((t) => t.id === id)?.full_name || 'Not assigned'
    const items = data.actions
      .filter(
        (a) =>
          inRange(a.reported_date, f.from, f.to) &&
          (!f.technician ||
            (f.technician === '__none__' ? !a.assigned_technician_id : a.assigned_technician_id === f.technician)) &&
          (!f.status || a.status === f.status) &&
          (!f.priority || a.priority === f.priority)
      )
      .sort((a, b) => new Date(b.reported_date) - new Date(a.reported_date))
    return {
      title: 'Technician Report',
      filterText: [
        ['Reported', rangeText(f.from, f.to, fmtDay)],
        ['Technician', f.technician === '__none__' ? 'Not assigned' : f.technician ? techName(f.technician) : 'All technicians'],
        ['Status', f.status ? ACTION_STATUS_LABELS[f.status] : 'All statuses'],
        ['Priority', f.priority ? cap(f.priority) : 'All priorities']
      ],
      columns: ['#', 'Reported', 'Code', 'Type', 'Problem', 'Technician', 'Priority', 'Status', 'Completed'],
      rows: items.map((a, n) => {
        let status = ACTION_STATUS_LABELS[a.status] || a.status
        if (a.status === 'in_progress' && a.repair_status === 'repaired') status += ' (marked repaired)'
        else if (a.status === 'in_progress' && a.repair_status === 'working') status += ' (working)'
        return [
          String(n + 1),
          ctx.formatTimestamp(a.reported_date),
          a.equipment?.equipment_code || '—',
          a.equipment ? ctx.typeLabel(a.equipment.equipment_type) : '—',
          a.description || '—',
          a.assigned_technician_id ? techName(a.assigned_technician_id) : 'Not assigned',
          cap(a.priority),
          status,
          a.completed_date ? ctx.formatTimestamp(a.completed_date) : '—'
        ]
      }),
      total: items.length,
      unit: 'job'
    }
  }

  if (key === 'purchase') {
    const bName = f.building ? buildingName(ctx, f.building) : ''
    const items = data.purchaseItems.filter(
      (p) => (!f.type || p.type === f.type) && (!f.building || p.building === bName)
    )
    return {
      title: 'Purchase Requests Needed',
      filterText: [
        ['Type', f.type ? ctx.typeLabel(f.type) : 'All types'],
        ['Building', buildingName(ctx, f.building)]
      ],
      columns: ['#', 'Code', 'Type', 'Building', 'Location', 'Reason', 'Priority', 'Stock on hand'],
      rows: items.map((p, n) => [
        String(n + 1),
        p.code || '—',
        ctx.typeLabel(p.type),
        p.building || '—',
        p.location || '—',
        p.reason || '—',
        cap(p.priority),
        String(p.stockOnHand)
      ]),
      total: items.length,
      unit: 'unit'
    }
  }

  if (key === 'expiry') {
    const within = Number(f.within) || 30
    const items = data.equipment
      .filter((e) => e.current_status !== 'no_longer_in_service')
      .map((e) => ({ ...e, daysLeft: ctx.daysUntil(e.expiration_date) }))
      .filter(
        (e) =>
          e.daysLeft !== null &&
          (f.show === 'expired' ? e.daysLeft < 0 : f.show === 'expiring' ? e.daysLeft >= 0 && e.daysLeft <= within : e.daysLeft <= within) &&
          (!f.type || e.equipment_type === f.type) &&
          (!f.building || e.building_id === f.building)
      )
      .sort((a, b) => a.daysLeft - b.daysLeft)
    const showText = f.show === 'expired' ? 'Expired only' : f.show === 'expiring' ? `Expiring within ${within} days` : `Expired, or expiring within ${within} days`
    return {
      title: 'Expiring / Expired Equipment',
      filterText: [
        ['Show', showText],
        ['Type', f.type ? ctx.typeLabel(f.type) : 'All types'],
        ['Building', buildingName(ctx, f.building)]
      ],
      columns: ['#', 'Code', 'Type', 'Building', 'Location', 'Expiration date', 'State'],
      rows: items.map((e, n) => [
        String(n + 1),
        e.equipment_code,
        ctx.typeLabel(e.equipment_type),
        e.buildings?.building_name ?? '—',
        e.exact_location || '—',
        ctx.formatTimestamp(e.expiration_date),
        e.daysLeft < 0
          ? `Expired ${Math.abs(e.daysLeft)} day${Math.abs(e.daysLeft) === 1 ? '' : 's'} ago`
          : e.daysLeft === 0
          ? 'Expires today'
          : `In ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}`
      ]),
      total: items.length,
      unit: 'unit'
    }
  }

  if (key === 'changes') {
    const items = (data.changeLog || []).filter(
      (c) =>
        inRange(c.changed_at, f.from, f.to) &&
        (!f.area || c.table_name === f.area) &&
        (!f.person || (c.actor_name || 'Unknown') === f.person)
    )
    return {
      title: 'Change Log',
      filterText: [
        ['Dates', rangeText(f.from, f.to, fmtDay)],
        ['Area', f.area ? CHANGE_AREAS[f.area] || f.area : 'All areas'],
        ['Changed by', f.person || 'Everyone']
      ],
      columns: ['#', 'Date and time', 'Changed by', 'Area', 'Record', 'Change'],
      rows: items.map((c, n) => [
        String(n + 1),
        ctx.formatTimestamp(c.changed_at),
        `${c.actor_name || 'Unknown'}${c.actor_role ? ` (${c.actor_role})` : ''}`,
        CHANGE_AREAS[c.table_name] || c.table_name,
        c.row_label || '—',
        describeChanges(c)
      ]),
      total: items.length,
      unit: 'change'
    }
  }

  return null
}

export { PRIORITIES, RESULT_LABELS }
