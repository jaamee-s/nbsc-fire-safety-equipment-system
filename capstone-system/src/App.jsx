import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'
import Login from './Login'

const EQUIPMENT_TYPES = [
  'fire_extinguisher',
  'fire_alarm',
  'sprinkler',
  'emergency_light',
  'smoke_detector'
]

const STATUS_OPTIONS = [
  'active',
  'defective',
  'for_repair',
  'for_replacement',
  'expired',
  'inactive'
]

const PRIORITY_ORDER = { critical: 1, high: 2, medium: 3, low: 4 }

const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}

const STATUS_LABELS = {
  active: 'Active',
  defective: 'Defective',
  for_repair: 'For Repair',
  for_replacement: 'For Replacement',
  expired: 'Expired',
  inactive: 'Inactive'
}

const CODE_PREFIXES = {
  fire_extinguisher: 'FE',
  fire_alarm: 'FA',
  sprinkler: 'SR',
  emergency_light: 'EL',
  smoke_detector: 'SD'
}

// Action types that mean something is actually being bought, and therefore
// have to pass a budget-availability check before work can start.
// A plain repair or inspection uses existing manpower — no purchase request.
const PURCHASE_ACTION_TYPES = ['replace', 'battery_replacement', 'refill']

async function generateEquipmentCode(supabase, equipmentType) {
  const prefix = CODE_PREFIXES[equipmentType] || 'EQ'

  const { data, error } = await supabase
    .from('equipment')
    .select('equipment_code')
    .ilike('equipment_code', `${prefix}-%`)

  if (error) {
    console.error('Error generating equipment code:', error)
    return `${prefix}-001`
  }

  let maxNumber = 0
  data.forEach((row) => {
    const match = row.equipment_code?.match(/-(\d+)$/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNumber) maxNumber = num
    }
  })

  const nextNumber = maxNumber + 1
  return `${prefix}-${String(nextNumber).padStart(3, '0')}`
}

function daysAgo(dateString) {
  if (!dateString) return null
  const then = new Date(dateString)
  const now = new Date()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

// Full date + clock time, in the viewer's local timezone.
// inspection_date is stored as timestamptz, so the exact moment of submission survives.
function formatTimestamp(dateString) {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function relativeTime(dateString) {
  if (!dateString) return ''
  const diffMs = new Date() - new Date(dateString)
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

/**
 * A printable sticker for one piece of equipment.
 *
 * The QR encodes ONLY the equipment code — never the location or expiry.
 * Those change over the unit's life; the sticker cannot. The scanner uses
 * the code to look the record up live, so a sticker printed today stays
 * accurate after the unit is moved, refilled, or re-inspected.
 */
function QrLabel({ item }) {
  return (
    <div className="qr-label">
      <QRCodeSVG value={item.qr_code || item.equipment_code} size={110} level="M" />
      <div className="qr-label-text">
        <div className="qr-label-code">{item.equipment_code}</div>
        <div className="qr-label-type">{TYPE_LABELS[item.equipment_type] || item.equipment_type}</div>
        <div className="qr-label-loc">
          {item.buildings?.building_name ?? '—'}
          <br />
          {item.exact_location}
        </div>
        <div className="qr-label-foot">NBSC Fire Safety · Scan to inspect</div>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showLoginSuccess, setShowLoginSuccess] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else {
        setProfile(null)
        setAuthLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    setAuthLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error loading profile:', error)
    } else {
      setProfile(data)
    }
    setAuthLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (!session) {
    return <Login onLoginSuccess={() => setShowLoginSuccess(true)} />
  }

  const successModal = showLoginSuccess ? (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-title">Login Successful</div>
        <p className="modal-message">
          Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}. You are now signed in
          to the NBSC Fire Safety Equipment System.
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => setShowLoginSuccess(false)}>
            OK
          </button>
        </div>
      </div>
    </div>
  ) : null

  if (authLoading) {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <p style={{ color: '#fff' }}>Loading...</p>
        </div>
      </>
    )
  }

  if (!profile) {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <div className="login-card">
            <h1>No profile found</h1>
            <p className="login-subtitle">
              Your account isn't linked to a profile yet. Ask your Admin to add you to the
              profiles table.
            </p>
            <button className="btn btn-secondary" style={{ marginTop: '16px' }} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </>
    )
  }

  if (profile.role === 'inspector') {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <div className="login-card">
            <h1>Inspector Account</h1>
            <p className="login-subtitle">
              Inspections are performed through the NBSC Fire Safety mobile app.
              Please use the Android app to scan equipment and submit inspections.
            </p>
            <button className="btn btn-secondary" style={{ marginTop: '16px' }} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {successModal}
      <Dashboard profile={profile} onLogout={handleLogout} />
    </>
  )
}

function Dashboard({ profile, onLogout }) {
  const [equipment, setEquipment] = useState([])
  const [buildings, setBuildings] = useState([])
  const [maintenanceActions, setMaintenanceActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const [form, setForm] = useState({
    equipment_code: '',
    equipment_type: EQUIPMENT_TYPES[0],
    building_id: '',
    exact_location: '',
    qr_code: '',
    installation_date: '',
    expiration_date: '',
    current_status: 'active',
    description: ''
  })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState(null)

  const [actionUpdatingId, setActionUpdatingId] = useState(null)

  // Inspection history state
  const [inspections, setInspections] = useState([])
  const [expandedHistoryId, setExpandedHistoryId] = useState(null)

  // QR label state
  const [expandedQrId, setExpandedQrId] = useState(null)
  const [qrPrintItems, setQrPrintItems] = useState([])

  // Rendering the print sheet has to finish before the print dialog opens,
  // so we trigger printing from an effect rather than inside the click handler.
  useEffect(() => {
    if (qrPrintItems.length === 0) return
    const timer = setTimeout(() => {
      window.print()
      setQrPrintItems([])
    }, 200)
    return () => clearTimeout(timer)
  }, [qrPrintItems])

  // Equipment search / filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBuilding, setFilterBuilding] = useState('')

  // Building management state
  const [showBuildingForm, setShowBuildingForm] = useState(false)
  const [buildingForm, setBuildingForm] = useState({ building_name: '', location_description: '' })
  const [buildingSubmitting, setBuildingSubmitting] = useState(false)
  const [buildingError, setBuildingError] = useState(null)
  const [editingBuildingId, setEditingBuildingId] = useState(null)
  const [editBuildingForm, setEditBuildingForm] = useState({})
  const [editBuildingSaving, setEditBuildingSaving] = useState(false)
  const [editBuildingError, setEditBuildingError] = useState(null)

  // Building location (floor/room) management state
  const [buildingLocations, setBuildingLocations] = useState([])
  const [expandedLocationsBuildingId, setExpandedLocationsBuildingId] = useState(null)
  const [locationForm, setLocationForm] = useState({ floor_label: '', location_label: '' })
  const [locationSubmitting, setLocationSubmitting] = useState(false)
  const [locationError, setLocationError] = useState(null)
  const [locationFloorMode, setLocationFloorMode] = useState('select')
  const [bulkForm, setBulkForm] = useState({ floor_label: '', prefix: 'Room ', start: '', end: '' })
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkError, setBulkError] = useState(null)
  const [bulkFloorMode, setBulkFloorMode] = useState('select')

  // Add Equipment form: cascading location picker state
  const [formFloor, setFormFloor] = useState('')
  const [formLocationChoice, setFormLocationChoice] = useState('')

  useEffect(() => {
    getEquipment()
    getBuildings()
    getMaintenanceActions()
    getBuildingLocations()
    getInspections()
  }, [])

  async function getEquipment() {
    setLoading(true)
    const { data, error } = await supabase
      .from('equipment')
      .select(`
        id, equipment_code, equipment_type, building_id, exact_location,
        qr_code, installation_date, expiration_date, current_status, description,
        buildings ( building_name )
      `)
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching equipment:', error)
    else setEquipment(data)
    setLoading(false)
  }

  async function getBuildings() {
    const { data, error } = await supabase
      .from('buildings')
      .select('id, building_name, location_description')
      .order('building_name', { ascending: true })

    if (error) console.error('Error fetching buildings:', error)
    else setBuildings(data)
  }

  function handleBuildingFormChange(e) {
    const { name, value } = e.target
    setBuildingForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleBuildingSubmit(e) {
    e.preventDefault()
    setBuildingError(null)

    if (!buildingForm.building_name.trim()) {
      setBuildingError('Building name is required.')
      return
    }

    setBuildingSubmitting(true)

    const { error } = await supabase.from('buildings').insert([
      {
        building_name: buildingForm.building_name,
        location_description: buildingForm.location_description || null
      }
    ])

    if (error) {
      console.error('Error inserting building:', error)
      setBuildingError(error.message)
    } else {
      setBuildingForm({ building_name: '', location_description: '' })
      setShowBuildingForm(false)
      getBuildings()
    }

    setBuildingSubmitting(false)
  }

  function startEditBuilding(b) {
    setEditingBuildingId(b.id)
    setEditBuildingError(null)
    setEditBuildingForm({
      building_name: b.building_name || '',
      location_description: b.location_description || ''
    })
  }

  function cancelEditBuilding() {
    setEditingBuildingId(null)
    setEditBuildingForm({})
    setEditBuildingError(null)
  }

  function handleEditBuildingChange(e) {
    const { name, value } = e.target
    setEditBuildingForm((prev) => ({ ...prev, [name]: value }))
  }

  async function saveEditBuilding(id) {
    setEditBuildingSaving(true)
    setEditBuildingError(null)

    if (!editBuildingForm.building_name.trim()) {
      setEditBuildingError('Building name is required.')
      setEditBuildingSaving(false)
      return
    }

    const { error } = await supabase
      .from('buildings')
      .update({
        building_name: editBuildingForm.building_name,
        location_description: editBuildingForm.location_description || null
      })
      .eq('id', id)

    if (error) {
      console.error('Error updating building:', error)
      setEditBuildingError(error.message)
    } else {
      setEditingBuildingId(null)
      setEditBuildingForm({})
      getBuildings()
      getEquipment() // refresh so equipment cards show updated building name
    }

    setEditBuildingSaving(false)
  }

  async function deleteBuilding(id, name) {
    const confirmed = window.confirm(
      `Delete "${name}"? This will fail if any equipment is still assigned to this building.`
    )
    if (!confirmed) return

    const { error } = await supabase.from('buildings').delete().eq('id', id)

    if (error) {
      console.error('Error deleting building:', error)
      alert(
        'Could not delete this building. It likely still has equipment assigned to it. ' +
          'Reassign or remove that equipment first.\n\n' +
          error.message
      )
    } else {
      getBuildings()
    }
  }

  async function getBuildingLocations() {
    const { data, error } = await supabase
      .from('building_locations')
      .select('id, building_id, floor_label, location_label')
      .order('floor_label', { ascending: true })
      .order('location_label', { ascending: true })

    if (error) console.error('Error fetching building locations:', error)
    else setBuildingLocations(data)
  }

  function handleLocationFormChange(e) {
    const { name, value } = e.target
    setLocationForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleLocationSubmit(e, buildingId) {
    e.preventDefault()
    setLocationError(null)

    if (!locationForm.floor_label.trim() || !locationForm.location_label.trim()) {
      setLocationError('Floor and location name are required.')
      return
    }

    setLocationSubmitting(true)

    const { error } = await supabase.from('building_locations').insert([
      {
        building_id: buildingId,
        floor_label: locationForm.floor_label.trim(),
        location_label: locationForm.location_label.trim()
      }
    ])

    if (error) {
      console.error('Error adding location:', error)
      setLocationError(error.message)
    } else {
      setLocationForm({ floor_label: locationForm.floor_label, location_label: '' })
      setLocationFloorMode('select')
      getBuildingLocations()
    }

    setLocationSubmitting(false)
  }

  function handleBulkFormChange(e) {
    const { name, value } = e.target
    setBulkForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleBulkSubmit(e, buildingId) {
    e.preventDefault()
    setBulkError(null)

    const start = parseInt(bulkForm.start, 10)
    const end = parseInt(bulkForm.end, 10)

    if (!bulkForm.floor_label.trim()) {
      setBulkError('Floor is required.')
      return
    }
    if (isNaN(start) || isNaN(end) || start > end) {
      setBulkError('Enter a valid start and end number (start must be less than or equal to end).')
      return
    }
    if (end - start > 200) {
      setBulkError('That range is too large (max 200 at a time).')
      return
    }

    setBulkSubmitting(true)

    const rows = []
    for (let n = start; n <= end; n++) {
      rows.push({
        building_id: buildingId,
        floor_label: bulkForm.floor_label.trim(),
        location_label: `${bulkForm.prefix}${n}`
      })
    }

    const { error } = await supabase.from('building_locations').insert(rows)

    if (error) {
      console.error('Error bulk adding locations:', error)
      setBulkError(error.message)
    } else {
      setBulkForm({ floor_label: bulkForm.floor_label, prefix: bulkForm.prefix, start: '', end: '' })
      setBulkFloorMode('select')
      getBuildingLocations()
    }

    setBulkSubmitting(false)
  }

  async function deleteLocation(id) {
    const { error } = await supabase.from('building_locations').delete().eq('id', id)
    if (error) {
      console.error('Error deleting location:', error)
      alert('Failed to delete location: ' + error.message)
    } else {
      getBuildingLocations()
    }
  }

  async function getMaintenanceActions() {
    const { data, error } = await supabase
      .from('maintenance_actions')
      .select(`
        id, action_type, description, priority, status, reported_date, due_date,
        disposition, budget_status,
        equipment ( id, equipment_code, equipment_type, exact_location,
          buildings ( building_name )
        )
      `)
      .in('status', ['pending', 'in_progress', 'delayed', 'for_disposal'])
      .order('reported_date', { ascending: true })

    if (error) console.error('Error fetching maintenance actions:', error)
    else setMaintenanceActions(data)
  }

  async function getInspections() {
    const { data, error } = await supabase
      .from('inspections')
      .select(`
        id, equipment_id, inspection_date, condition_status,
        findings, recommended_action, inspection_notes, action_required,
        inspector_name
      `)
      .order('inspection_date', { ascending: false })

    if (error) console.error('Error fetching inspections:', error)
    else setInspections(data)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleTypeChange(e) {
    const type = e.target.value
    const newCode = await generateEquipmentCode(supabase, type)
    setForm((prev) => ({
      ...prev,
      equipment_type: type,
      equipment_code: newCode,
      qr_code: newCode
    }))
  }

  async function openAddForm() {
    const willShow = !showAddForm
    setShowAddForm(willShow)
    if (willShow) {
      const newCode = await generateEquipmentCode(supabase, form.equipment_type)
      setForm((prev) => ({ ...prev, equipment_code: newCode, qr_code: newCode }))
    }
  }

  function handleFormBuildingChange(e) {
    const buildingId = e.target.value
    setForm((prev) => ({ ...prev, building_id: buildingId, exact_location: '' }))
    setFormFloor('')
    setFormLocationChoice('')
  }

  function handleFormFloorChange(e) {
    setFormFloor(e.target.value)
    setFormLocationChoice('')
    setForm((prev) => ({ ...prev, exact_location: '' }))
  }

  function handleFormLocationChoiceChange(e) {
    const locationLabel = e.target.value
    setFormLocationChoice(locationLabel)
    setForm((prev) => ({
      ...prev,
      exact_location: locationLabel ? `${formFloor} - ${locationLabel}` : ''
    }))
  }

  function jumpToBuildingSetup(buildingId) {
    setExpandedLocationsBuildingId(buildingId)
    document.getElementById('buildings-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)

    if (!form.equipment_code || !form.qr_code || !form.building_id) {
      setFormError('Equipment code, QR code, and building are required.')
      return
    }

    if (!form.exact_location || !formFloor || !formLocationChoice) {
      setFormError('Please select a floor and room/location for this equipment.')
      return
    }

    setSubmitting(true)

    const payload = {
      equipment_code: form.equipment_code,
      equipment_type: form.equipment_type,
      building_id: form.building_id,
      exact_location: form.exact_location || null,
      qr_code: form.qr_code,
      installation_date: form.installation_date || null,
      expiration_date: form.expiration_date || null,
      current_status: form.current_status,
      description: form.description || null
    }

    const { error } = await supabase.from('equipment').insert([payload])

    if (error) {
      console.error('Error inserting equipment:', error)
      setFormError(error.message)
    } else {
      setForm({
        equipment_code: '',
        equipment_type: EQUIPMENT_TYPES[0],
        building_id: '',
        exact_location: '',
        qr_code: '',
        installation_date: '',
        expiration_date: '',
        current_status: 'active',
        description: ''
      })
      setFormFloor('')
      setFormLocationChoice('')
      setShowAddForm(false)
      getEquipment()
    }

    setSubmitting(false)
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditError(null)
    setEditForm({
      equipment_code: item.equipment_code || '',
      equipment_type: item.equipment_type || EQUIPMENT_TYPES[0],
      building_id: item.building_id || '',
      exact_location: item.exact_location || '',
      qr_code: item.qr_code || '',
      installation_date: item.installation_date || '',
      expiration_date: item.expiration_date || '',
      current_status: item.current_status || 'active',
      description: item.description || ''
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({})
    setEditError(null)
  }

  function handleEditChange(e) {
    const { name, value } = e.target
    setEditForm((prev) => ({ ...prev, [name]: value }))
  }

  async function saveEdit(id) {
    setEditSaving(true)
    setEditError(null)

    if (!editForm.equipment_code || !editForm.qr_code || !editForm.building_id) {
      setEditError('Equipment code, QR code, and building are required.')
      setEditSaving(false)
      return
    }

    const payload = {
      equipment_code: editForm.equipment_code,
      equipment_type: editForm.equipment_type,
      building_id: editForm.building_id,
      exact_location: editForm.exact_location || null,
      qr_code: editForm.qr_code,
      installation_date: editForm.installation_date || null,
      expiration_date: editForm.expiration_date || null,
      current_status: editForm.current_status,
      description: editForm.description || null
    }

    const { error } = await supabase.from('equipment').update(payload).eq('id', id)

    if (error) {
      console.error('Error updating equipment:', error)
      setEditError(error.message)
    } else {
      setEditingId(null)
      setEditForm({})
      getEquipment()
    }

    setEditSaving(false)
  }

  async function updateActionStatus(actionId, newStatus, equipmentId) {
    setActionUpdatingId(actionId)

    const payload = { status: newStatus }
    if (newStatus === 'completed') payload.completed_date = new Date().toISOString()

    const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)

    if (error) {
      console.error('Error updating maintenance action:', error)
      alert('Failed to update action: ' + error.message)
      setActionUpdatingId(null)
      return
    }

    if (newStatus === 'completed' && equipmentId) {
      const { data: remainingActions, error: remainingError } = await supabase
        .from('maintenance_actions')
        .select('id')
        .eq('equipment_id', equipmentId)
        .in('status', ['pending', 'in_progress', 'delayed', 'for_disposal'])

      if (remainingError) {
        console.error('Error checking remaining actions:', remainingError)
      } else if (remainingActions.length === 0) {
        const { error: revertError } = await supabase
          .from('equipment')
          .update({ current_status: 'active' })
          .eq('id', equipmentId)
        if (revertError) console.error('Error reverting equipment status:', revertError)
      }
    }

    getMaintenanceActions()
    getEquipment()
    setActionUpdatingId(null)
  }

  // Fire extinguisher only: GSO decides Dispose vs Refillable
  async function setDisposition(actionId, disposition) {
    setActionUpdatingId(actionId)

    const payload = { disposition }
    if (disposition === 'dispose') {
      payload.status = 'for_disposal'
    }
    // 'refill' keeps status = 'pending' so the budget-check prompt appears next

    const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)

    if (error) {
      console.error('Error setting disposition:', error)
      alert('Failed to update: ' + error.message)
    } else {
      getMaintenanceActions()
    }

    setActionUpdatingId(null)
  }

  // Applies only to actions that require a purchase:
  // a fire extinguisher refill, or a replacement part on any other equipment.
  async function setBudgetStatus(actionId, budgetStatus) {
    setActionUpdatingId(actionId)

    const payload = { budget_status: budgetStatus }
    payload.status = budgetStatus === 'available' ? 'in_progress' : 'delayed'

    const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)

    if (error) {
      console.error('Error setting budget status:', error)
      alert('Failed to update: ' + error.message)
    } else {
      getMaintenanceActions()
    }

    setActionUpdatingId(null)
  }

  // A delayed item can be re-checked once budget might have freed up
  async function recheckBudget(actionId) {
    setActionUpdatingId(actionId)

    const { error } = await supabase
      .from('maintenance_actions')
      .update({ budget_status: 'not_applicable', status: 'pending' })
      .eq('id', actionId)

    if (error) {
      console.error('Error rechecking budget:', error)
      alert('Failed to update: ' + error.message)
    } else {
      getMaintenanceActions()
    }

    setActionUpdatingId(null)
  }

  // Fire extinguisher disposal confirmed by Supply Office — equipment retires permanently
  async function confirmDisposalCompleted(actionId, equipmentId) {
    setActionUpdatingId(actionId)

    const { error: actionError } = await supabase
      .from('maintenance_actions')
      .update({ status: 'completed', completed_date: new Date().toISOString() })
      .eq('id', actionId)

    if (actionError) {
      console.error('Error confirming disposal:', actionError)
      alert('Failed to update: ' + actionError.message)
      setActionUpdatingId(null)
      return
    }

    const { error: equipmentError } = await supabase
      .from('equipment')
      .update({ current_status: 'inactive' })
      .eq('id', equipmentId)

    if (equipmentError) console.error('Error retiring equipment:', equipmentError)

    getMaintenanceActions()
    getEquipment()
    setActionUpdatingId(null)
  }

  const sortedActions = [...maintenanceActions].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] || 5
    const pb = PRIORITY_ORDER[b.priority] || 5
    if (pa !== pb) return pa - pb
    return new Date(a.reported_date) - new Date(b.reported_date)
  })

  // Group inspections by equipment so each card can show its own history
  const inspectionsByEquipment = inspections.reduce((acc, insp) => {
    if (!acc[insp.equipment_id]) acc[insp.equipment_id] = []
    acc[insp.equipment_id].push(insp)
    return acc
  }, {})

  // A unit that has failed 2+ inspections is a recurring problem, not a one-off.
  // This is the pattern that justifies replacement over repeated repairs.
  const REPEAT_FAILURE_THRESHOLD = 2

  const totalEquipment = equipment.length
  const activeCount = equipment.filter((e) => e.current_status === 'active').length
  const needsActionCount = equipment.filter((e) => e.current_status !== 'active').length
  const pendingActionsCount = sortedActions.length

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function daysUntil(dateString) {
    if (!dateString) return null
    const target = new Date(dateString)
    target.setHours(0, 0, 0, 0)
    return Math.floor((target - today) / (1000 * 60 * 60 * 24))
  }

  const expiringEquipment = equipment
    .map((item) => ({ ...item, daysLeft: daysUntil(item.expiration_date) }))
    .filter((item) => item.daysLeft !== null && item.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  const expiredCount = expiringEquipment.filter((item) => item.daysLeft < 0).length

  const filteredEquipment = equipment.filter((item) => {
    const term = searchTerm.trim().toLowerCase()
    const matchesSearch =
      term === '' ||
      item.equipment_code?.toLowerCase().includes(term) ||
      item.exact_location?.toLowerCase().includes(term) ||
      item.buildings?.building_name?.toLowerCase().includes(term)

    const matchesType = !filterType || item.equipment_type === filterType
    const matchesStatus = !filterStatus || item.current_status === filterStatus
    const matchesBuilding = !filterBuilding || item.building_id === filterBuilding

    return matchesSearch && matchesType && matchesStatus && matchesBuilding
  })

  const locationsForSelectedBuilding = buildingLocations.filter(
    (loc) => loc.building_id === form.building_id
  )
  const floorsForSelectedBuilding = [...new Set(locationsForSelectedBuilding.map((l) => l.floor_label))]
  const locationsForSelectedFloor = locationsForSelectedBuilding.filter(
    (loc) => loc.floor_label === formFloor
  )
  const selectedBuildingHasLocations = locationsForSelectedBuilding.length > 0

  return (
    <div>
      <header className="app-header">
        <div className="title-block">
          <div className="badge-icon">🔥</div>
          <div>
            <h1>NBSC Fire Safety Equipment System</h1>
            <p>Inventory · Inspection · Maintenance Monitoring</p>
          </div>
        </div>

        <div className="header-search">
          <span className="header-search-icon">🔍</span>
          <input
            placeholder="Search equipment code, location, building..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                document.getElementById('equipment-inventory-section')?.scrollIntoView({ behavior: 'smooth' })
              }
            }}
          />
          {searchTerm && (
            <button className="header-search-clear" onClick={() => setSearchTerm('')}>
              ✕
            </button>
          )}
        </div>

        <div className="user-chip">
          <span className="status-chip" style={{ marginRight: '4px' }}>
            <span className={`status-dot ${needsActionCount > 0 ? 'alert' : ''}`}></span>
            {needsActionCount > 0 ? `${needsActionCount} need attention` : 'All operational'}
          </span>
          <span className="user-role-tag">{profile.full_name} · {profile.role}</span>
          <button className="logout-btn" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="page-wrap">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon blue">📦</div>
            <div>
              <div className="stat-value">{totalEquipment}</div>
              <div className="stat-label">Total Equipment</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">✓</div>
            <div>
              <div className="stat-value">{activeCount}</div>
              <div className="stat-label">Active</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon red">⚠</div>
            <div>
              <div className="stat-value">{needsActionCount}</div>
              <div className="stat-label">Needs Attention</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon amber">🛠</div>
            <div>
              <div className="stat-value">{pendingActionsCount}</div>
              <div className="stat-label">Pending Actions</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon amber">⏳</div>
            <div>
              <div className="stat-value">{expiringEquipment.length}</div>
              <div className="stat-label">Expiring / Expired</div>
            </div>
          </div>
        </div>

        <div className="section-heading">
          <h2>Priority Actions</h2>
          {sortedActions.length > 0 && (
            <span className="count-pill">{sortedActions.length} pending</span>
          )}
        </div>

        {sortedActions.length === 0 ? (
          <div className="all-clear-banner">
            ✓ No pending actions. All equipment accounted for.
          </div>
        ) : (
          sortedActions.map((action) => {
            const age = daysAgo(action.reported_date)
            const isOverdue = age !== null && age >= 7
            const isFireExtinguisher = action.equipment?.equipment_type === 'fire_extinguisher'

            // Stage 1 — fire extinguisher only: dispose or refill?
            const needsDispositionChoice =
              isFireExtinguisher && !action.disposition && action.status === 'pending'

            // Does this action actually involve buying something?
            const needsPurchase =
              (isFireExtinguisher && action.disposition === 'refill') ||
              PURCHASE_ACTION_TYPES.includes(action.action_type)

            // Stage 2 — budget check, only when a purchase request is involved
            const needsBudgetCheck =
              !needsDispositionChoice &&
              action.status === 'pending' &&
              action.budget_status === 'not_applicable' &&
              needsPurchase

            // Stage 2b — repair / inspection / other: no purchase, GSO just starts the work
            const needsStartWork =
              !needsDispositionChoice && !needsBudgetCheck && action.status === 'pending'

            let cardStyle = isOverdue ? 'overdue' : 'warning'
            if (action.status === 'for_disposal') cardStyle = 'warning'
            if (action.status === 'delayed') cardStyle = 'overdue'

            return (
              <div key={action.id} className={`action-card ${cardStyle}`}>
                <div className="action-title">
                  ⚠ {action.equipment?.equipment_code} —{' '}
                  {TYPE_LABELS[action.equipment?.equipment_type] || action.equipment?.equipment_type}
                  {isOverdue && action.status === 'pending' && <span className="overdue-tag">OVERDUE</span>}
                  {action.status === 'delayed' && <span className="overdue-tag">DELAYED</span>}
                  {action.status === 'for_disposal' && <span className="overdue-tag">FOR DISPOSAL</span>}
                </div>
                <p>
                  {action.equipment?.buildings?.building_name ?? 'N/A'} — {action.equipment?.exact_location}
                </p>
                <p>{action.description} <span style={{ color: 'var(--text-muted)' }}>({action.action_type})</span></p>
                <p>
                  Priority: <strong style={{ textTransform: 'capitalize' }}>{action.priority}</strong>{' '}
                  &nbsp;·&nbsp; Status: <strong style={{ textTransform: 'capitalize' }}>{action.status.replace('_', ' ')}</strong>
                </p>

                {(action.disposition || action.budget_status !== 'not_applicable') && (
                  <p style={{ color: 'var(--text-muted)' }}>
                    {action.disposition && (
                      <>Decision: <strong>{action.disposition === 'dispose' ? 'Dispose' : 'Refillable'}</strong></>
                    )}
                    {action.disposition && action.budget_status !== 'not_applicable' && ' · '}
                    {action.budget_status !== 'not_applicable' && (
                      <>Budget: <strong>{action.budget_status === 'available' ? 'Available' : 'Not available'}</strong></>
                    )}
                  </p>
                )}

                <div className="meta">
                  Reported {age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`}
                </div>

                {/* Stage 1: Fire extinguisher — Dispose vs Refillable */}
                {needsDispositionChoice && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 8px 0' }}>
                      Decision needed: dispose this unit, or is it refillable?
                    </p>
                    <div className="action-buttons">
                      <button
                        className="btn btn-outline-red btn-sm"
                        onClick={() => setDisposition(action.id, 'dispose')}
                        disabled={actionUpdatingId === action.id}
                      >
                        Dispose (report to Supply Office)
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setDisposition(action.id, 'refill')}
                        disabled={actionUpdatingId === action.id}
                      >
                        Refillable (create PPMP request)
                      </button>
                    </div>
                  </div>
                )}

                {/* Stage 2: Budget check — only when something is being purchased */}
                {needsBudgetCheck && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 8px 0' }}>
                      Purchase request needed. Is budget available?
                    </p>
                    <div className="action-buttons">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setBudgetStatus(action.id, 'available')}
                        disabled={actionUpdatingId === action.id}
                      >
                        Budget Available (proceed)
                      </button>
                      <button
                        className="btn btn-outline-red btn-sm"
                        onClick={() => setBudgetStatus(action.id, 'unavailable')}
                        disabled={actionUpdatingId === action.id}
                      >
                        Not Available
                      </button>
                    </div>
                  </div>
                )}

                {/* Stage 2b: No purchase involved — start the work directly */}
                {needsStartWork && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                      No purchase request needed for this action.
                    </p>
                    <div className="action-buttons">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => updateActionStatus(action.id, 'in_progress', action.equipment?.id)}
                        disabled={actionUpdatingId === action.id}
                      >
                        Start Work
                      </button>
                    </div>
                  </div>
                )}

                {/* Stage: Delayed — waiting on budget */}
                {action.status === 'delayed' && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--red)', margin: '0 0 8px 0' }}>
                      Delayed — budget was not available. Re-check once funds may be free.
                    </p>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => recheckBudget(action.id)}
                      disabled={actionUpdatingId === action.id}
                    >
                      Re-check Budget
                    </button>
                  </div>
                )}

                {/* Stage: For disposal — waiting on Supply Office */}
                {action.status === 'for_disposal' && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                      Reported to Supply Office for disposal. Confirm once processed.
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => confirmDisposalCompleted(action.id, action.equipment?.id)}
                      disabled={actionUpdatingId === action.id}
                    >
                      Confirm Disposal Completed
                    </button>
                  </div>
                )}

                {/* Stage: In progress (budget approved, or work already started) */}
                {action.status === 'in_progress' && (
                  <div className="action-buttons">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => updateActionStatus(action.id, 'completed', action.equipment?.id)}
                      disabled={actionUpdatingId === action.id}
                    >
                      Mark Completed
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}

        <div className="section-heading">
          <h2>Expiration Alerts</h2>
          {expiringEquipment.length > 0 && (
            <span className="count-pill">{expiringEquipment.length} flagged</span>
          )}
        </div>

        {expiringEquipment.length === 0 ? (
          <div className="all-clear-banner">
            ✓ No equipment expiring within 30 days.
          </div>
        ) : (
          expiringEquipment.map((item) => {
            const isExpired = item.daysLeft < 0
            return (
              <div key={item.id} className={`action-card ${isExpired ? 'overdue' : 'warning'}`}>
                <div className="action-title">
                  ⏳ {item.equipment_code} — {TYPE_LABELS[item.equipment_type] || item.equipment_type}
                  {isExpired && <span className="overdue-tag">EXPIRED</span>}
                </div>
                <p>
                  {item.buildings?.building_name ?? 'N/A'} — {item.exact_location}
                </p>
                <p>
                  Expiration Date: <strong>{item.expiration_date}</strong>
                </p>
                <div className="meta">
                  {isExpired
                    ? `Expired ${Math.abs(item.daysLeft)} day${Math.abs(item.daysLeft) === 1 ? '' : 's'} ago`
                    : item.daysLeft === 0
                    ? 'Expires today'
                    : `Expires in ${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`}
                </div>
              </div>
            )
          })
        )}

        <div className="section-heading" id="buildings-section">
          <h2>Buildings</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowBuildingForm((v) => !v)}>
            {showBuildingForm ? 'Close' : '+ Add Building'}
          </button>
        </div>

        {showBuildingForm && (
          <div className="panel">
            <form onSubmit={handleBuildingSubmit} className="form-grid">
              <div>
                <label className="field-label">Building Name</label>
                <input
                  name="building_name"
                  placeholder="e.g. SC Building"
                  value={buildingForm.building_name}
                  onChange={handleBuildingFormChange}
                />
              </div>
              <div>
                <label className="field-label">Location Description</label>
                <input
                  name="location_description"
                  placeholder="e.g. Main Campus, near the gate"
                  value={buildingForm.location_description}
                  onChange={handleBuildingFormChange}
                />
              </div>

              {buildingError && <p className="form-error">{buildingError}</p>}

              <button type="submit" className="btn btn-primary" disabled={buildingSubmitting}>
                {buildingSubmitting ? 'Saving...' : 'Add Building'}
              </button>
            </form>
          </div>
        )}

        {buildings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>No buildings added yet.</p>
        ) : (
          <div style={{ marginBottom: '10px' }}>
            {buildings.map((b) => (
              <div key={b.id} className="panel">
                {editingBuildingId === b.id ? (
                  <div className="form-grid">
                    <div>
                      <label className="field-label">Building Name</label>
                      <input
                        name="building_name"
                        value={editBuildingForm.building_name}
                        onChange={handleEditBuildingChange}
                      />
                    </div>
                    <div>
                      <label className="field-label">Location Description</label>
                      <input
                        name="location_description"
                        value={editBuildingForm.location_description}
                        onChange={handleEditBuildingChange}
                      />
                    </div>

                    {editBuildingError && <p className="form-error">{editBuildingError}</p>}

                    <div className="equipment-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => saveEditBuilding(b.id)}
                        disabled={editBuildingSaving}
                      >
                        {editBuildingSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button className="btn btn-secondary" onClick={cancelEditBuilding} disabled={editBuildingSaving}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="equipment-card-head">
                      <div>
                        <div className="equipment-title">{b.building_name}</div>
                        <div className="equipment-meta">{b.location_description || 'No description'}</div>
                      </div>
                      <div className="equipment-actions" style={{ marginTop: 0 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEditBuilding(b)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-outline-red btn-sm"
                          onClick={() => deleteBuilding(b.id, b.building_name)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="equipment-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setExpandedLocationsBuildingId(expandedLocationsBuildingId === b.id ? null : b.id)
                        }
                      >
                        {expandedLocationsBuildingId === b.id ? 'Hide Floors/Rooms' : 'Manage Floors/Rooms'}
                      </button>
                    </div>

                    {expandedLocationsBuildingId === b.id && (
                      <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                        {(() => {
                          const locsForThisBuilding = buildingLocations.filter((l) => l.building_id === b.id)
                          const floorGroups = [...new Set(locsForThisBuilding.map((l) => l.floor_label))]

                          return (
                            <>
                              {floorGroups.length === 0 ? (
                                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                                  No floors/rooms added yet for this building.
                                </p>
                              ) : (
                                floorGroups.map((floor) => (
                                  <div key={floor} style={{ marginBottom: '12px' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '6px' }}>
                                      {floor}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                      {locsForThisBuilding
                                        .filter((l) => l.floor_label === floor)
                                        .map((l) => (
                                          <span
                                            key={l.id}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              background: 'var(--gray-bg)',
                                              border: '1px solid var(--border)',
                                              borderRadius: '999px',
                                              padding: '4px 10px',
                                              fontSize: '0.82rem'
                                            }}
                                          >
                                            {l.location_label}
                                            <button
                                              onClick={() => deleteLocation(l.id)}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--red)',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                padding: 0
                                              }}
                                              title="Remove"
                                            >
                                              ✕
                                            </button>
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                ))
                              )}

                              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '10px' }}>
                                <form
                                  onSubmit={(e) => handleLocationSubmit(e, b.id)}
                                  style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Add Single Location</div>

                                  {floorGroups.length > 0 && locationFloorMode === 'select' ? (
                                    <select
                                      value={locationForm.floor_label}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          setLocationFloorMode('new')
                                          setLocationForm((prev) => ({ ...prev, floor_label: '' }))
                                        } else {
                                          setLocationForm((prev) => ({ ...prev, floor_label: e.target.value }))
                                        }
                                      }}
                                    >
                                      <option value="">-- Select Floor --</option>
                                      {floorGroups.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                      <option value="__new__">+ Add New Floor...</option>
                                    </select>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        name="floor_label"
                                        placeholder="New floor name (e.g. 1st Floor)"
                                        value={locationForm.floor_label}
                                        onChange={handleLocationFormChange}
                                        style={{ flex: 1 }}
                                      />
                                      {floorGroups.length > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => {
                                            setLocationFloorMode('select')
                                            setLocationForm((prev) => ({ ...prev, floor_label: '' }))
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <input
                                    name="location_label"
                                    placeholder="Location (e.g. Male CR - Left side)"
                                    value={locationForm.location_label}
                                    onChange={handleLocationFormChange}
                                  />
                                  {locationError && <p className="form-error">{locationError}</p>}
                                  <button className="btn btn-primary btn-sm" type="submit" disabled={locationSubmitting}>
                                    {locationSubmitting ? 'Adding...' : 'Add Location'}
                                  </button>
                                </form>

                                <form
                                  onSubmit={(e) => handleBulkSubmit(e, b.id)}
                                  style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                    Bulk Add Rooms (e.g. Room 101–110)
                                  </div>

                                  {floorGroups.length > 0 && bulkFloorMode === 'select' ? (
                                    <select
                                      value={bulkForm.floor_label}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          setBulkFloorMode('new')
                                          setBulkForm((prev) => ({ ...prev, floor_label: '' }))
                                        } else {
                                          setBulkForm((prev) => ({ ...prev, floor_label: e.target.value }))
                                        }
                                      }}
                                    >
                                      <option value="">-- Select Floor --</option>
                                      {floorGroups.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                      <option value="__new__">+ Add New Floor...</option>
                                    </select>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        name="floor_label"
                                        placeholder="New floor name (e.g. 1st Floor)"
                                        value={bulkForm.floor_label}
                                        onChange={handleBulkFormChange}
                                        style={{ flex: 1 }}
                                      />
                                      {floorGroups.length > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => {
                                            setBulkFloorMode('select')
                                            setBulkForm((prev) => ({ ...prev, floor_label: '' }))
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <input
                                    name="prefix"
                                    placeholder="Prefix (e.g. Room )"
                                    value={bulkForm.prefix}
                                    onChange={handleBulkFormChange}
                                  />
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                      name="start"
                                      type="number"
                                      placeholder="Start (101)"
                                      value={bulkForm.start}
                                      onChange={handleBulkFormChange}
                                    />
                                    <input
                                      name="end"
                                      type="number"
                                      placeholder="End (110)"
                                      value={bulkForm.end}
                                      onChange={handleBulkFormChange}
                                    />
                                  </div>
                                  {bulkError && <p className="form-error">{bulkError}</p>}
                                  <button className="btn btn-primary btn-sm" type="submit" disabled={bulkSubmitting}>
                                    {bulkSubmitting ? 'Generating...' : 'Generate Rooms'}
                                  </button>
                                </form>

                              </div>
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="section-heading" id="equipment-inventory-section">
          <h2>Equipment Inventory</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setQrPrintItems(filteredEquipment)}
              disabled={filteredEquipment.length === 0}
            >
              🖨 Print QR Labels ({filteredEquipment.length})
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAddForm}>
              {showAddForm ? 'Close' : '+ Add Equipment'}
            </button>
          </div>
        </div>


        {showAddForm && (
          <div className="panel">
            <form onSubmit={handleSubmit} className="form-grid">
              <div>
                <label className="field-label">Equipment Type</label>
                <select name="equipment_type" value={form.equipment_type} onChange={handleTypeChange}>
                  {EQUIPMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Equipment Code (auto-generated)</label>
                <input name="equipment_code" value={form.equipment_code} disabled />
              </div>

              <div>
                <label className="field-label">Building</label>
                <select name="building_id" value={form.building_id} onChange={handleFormBuildingChange}>
                  <option value="">-- Select Building --</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.building_name}</option>
                  ))}
                </select>
              </div>

              {form.building_id && selectedBuildingHasLocations && (
                <>
                  <div>
                    <label className="field-label">Floor</label>
                    <select value={formFloor} onChange={handleFormFloorChange}>
                      <option value="">-- Select Floor --</option>
                      {floorsForSelectedBuilding.map((floor) => (
                        <option key={floor} value={floor}>{floor}</option>
                      ))}
                    </select>
                  </div>

                  {formFloor && (
                    <div>
                      <label className="field-label">Room / Location</label>
                      <select value={formLocationChoice} onChange={handleFormLocationChoiceChange}>
                        <option value="">-- Select Location --</option>
                        {locationsForSelectedFloor.map((loc) => (
                          <option key={loc.id} value={loc.location_label}>{loc.location_label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {form.building_id && !selectedBuildingHasLocations && (
                <div
                  style={{
                    background: 'var(--amber-bg)',
                    border: '1px solid var(--amber-border)',
                    borderRadius: '8px',
                    padding: '14px'
                  }}
                >
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.88rem', color: 'var(--amber)' }}>
                    This building has no floors/rooms set up yet. You must add at least one before
                    you can assign equipment to it — this keeps every location consistent and prevents typos.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => jumpToBuildingSetup(form.building_id)}
                  >
                    Set Up Floors/Rooms Now →
                  </button>
                </div>
              )}


              <div>
                <label className="field-label">QR Code Value (auto-generated)</label>
                <input name="qr_code" value={form.qr_code} disabled />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Installation Date</label>
                  <input type="date" name="installation_date" value={form.installation_date} onChange={handleChange} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Expiration Date</label>
                  <input type="date" name="expiration_date" value={form.expiration_date} onChange={handleChange} />
                </div>
              </div>

              <div>
                <label className="field-label">Status</label>
                <select name="current_status" value={form.current_status} onChange={handleChange}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Description</label>
                <textarea name="description" placeholder="Optional" value={form.description} onChange={handleChange} />
              </div>

              {formError && <p className="form-error">{formError}</p>}

              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving...' : 'Add Equipment'}
              </button>
            </form>
          </div>
        )}

        <div className="panel" style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label"> Equipment Type</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">All Types</option>
                {EQUIPMENT_TYPES.map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Building</label>
              <select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)}>
                <option value="">All Buildings</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.building_name}</option>
                ))}
              </select>
            </div>
          </div>
          {(searchTerm || filterType || filterStatus || filterBuilding) && (
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Showing {filteredEquipment.length} of {equipment.length}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearchTerm('')
                  setFilterType('')
                  setFilterStatus('')
                  setFilterBuilding('')
                }}
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <p>Loading equipment...</p>
        ) : filteredEquipment.length === 0 ? (
          <p>No equipment matches your search/filters.</p>
        ) : (
          filteredEquipment.map((item) => (
            <div key={item.id} className="panel">
              {editingId === item.id ? (
                <div className="form-grid">
                  <div>
                    <label className="field-label">Equipment Code (locked)</label>
                    <input name="equipment_code" value={editForm.equipment_code} disabled />
                  </div>
                  <div>
                    <label className="field-label">Equipment Type</label>
                    <select name="equipment_type" value={editForm.equipment_type} onChange={handleEditChange}>
                      {EQUIPMENT_TYPES.map((type) => (
                        <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Building</label>
                    <select name="building_id" value={editForm.building_id} onChange={handleEditChange}>
                      <option value="">-- Select Building --</option>
                      {buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.building_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Exact Location</label>
                    <input name="exact_location" value={editForm.exact_location} onChange={handleEditChange} />
                  </div>
                  <div>
                    <label className="field-label">QR Code Value (locked)</label>
                    <input name="qr_code" value={editForm.qr_code} disabled />
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">Installation Date</label>
                      <input type="date" name="installation_date" value={editForm.installation_date || ''} onChange={handleEditChange} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">Expiration Date</label>
                      <input type="date" name="expiration_date" value={editForm.expiration_date || ''} onChange={handleEditChange} />
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Status</label>
                    <select name="current_status" value={editForm.current_status} onChange={handleEditChange}>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Description</label>
                    <textarea name="description" value={editForm.description} onChange={handleEditChange} />
                  </div>

                  {editError && <p className="form-error">{editError}</p>}

                  <div className="equipment-actions">
                    <button className="btn btn-primary" onClick={() => saveEdit(item.id)} disabled={editSaving}>
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button className="btn btn-secondary" onClick={cancelEdit} disabled={editSaving}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                (() => {
                  const history = inspectionsByEquipment[item.id] || []
                  const failures = history.filter((i) => i.condition_status === 'defective').length
                  const isRepeatOffender = failures >= REPEAT_FAILURE_THRESHOLD

                  return (
                    <div>
                      <div className="equipment-card-head">
                        <div>
                          <div className="equipment-title">
                            {item.equipment_code} — {TYPE_LABELS[item.equipment_type] || item.equipment_type}
                            {isRepeatOffender && (
                              <span className="overdue-tag" style={{ marginLeft: '9px' }}>
                                {failures}× FAILED
                              </span>
                            )}
                          </div>
                          <div className="equipment-meta">
                            {item.buildings?.building_name ?? 'Not assigned'} · {item.exact_location}
                          </div>
                          <div className="equipment-meta">Expires: {item.expiration_date || '—'}</div>
                        </div>
                        <span className={`status-badge ${item.current_status === 'active' ? 'active' : 'inactive-state'}`}>
                          {item.current_status === 'active' ? '✓ Active' : `⚠ ${STATUS_LABELS[item.current_status] || item.current_status}`}
                        </span>
                      </div>

                      {isRepeatOffender && (
                        <p style={{ fontSize: '0.85rem', color: 'var(--red)', margin: '8px 0 0 0' }}>
                          This unit has failed {failures} inspections. Consider replacement instead of
                          another repair.
                        </p>
                      )}

                      <div className="equipment-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>Edit</button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setExpandedQrId(expandedQrId === item.id ? null : item.id)}
                        >
                          {expandedQrId === item.id ? 'Hide QR' : 'QR Code'}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                        >
                          {expandedHistoryId === item.id
                            ? 'Hide History'
                            : `Inspection History (${history.length})`}
                        </button>
                      </div>

                      {expandedQrId === item.id && (
                        <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                          <QrLabel item={item} />
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '10px 0' }}>
                            Encodes <strong>{item.qr_code}</strong> only. Scanning looks the record up
                            live, so this sticker stays accurate if the unit is moved or refilled.
                          </p>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => setQrPrintItems([item])}
                          >
                            🖨 Print This Label
                          </button>
                        </div>
                      )}

                      {expandedHistoryId === item.id && (
                        <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                          {history.length === 0 ? (
                            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                              No inspections recorded yet. Inspections are submitted from the mobile app.
                            </p>
                          ) : (
                            history.map((insp) => {
                              const failed = insp.condition_status === 'defective'
                              return (
                                <div
                                  key={insp.id}
                                  style={{
                                    borderLeft: `3px solid ${failed ? 'var(--red)' : 'var(--green)'}`,
                                    paddingLeft: '12px',
                                    marginBottom: '14px'
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '9px',
                                      flexWrap: 'wrap'
                                    }}
                                  >
                                    <span className={`status-badge ${failed ? 'inactive-state' : 'active'}`}>
                                      {failed ? '⚠ Defective' : '✓ Functional'}
                                    </span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                      {formatTimestamp(insp.inspection_date)}
                                      <span style={{ opacity: 0.75 }}>
                                        {' · '}{relativeTime(insp.inspection_date)}
                                      </span>
                                    </span>
                                  </div>

                                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }}>
                                    Inspected by: <strong>{insp.inspector_name || 'Not recorded'}</strong>
                                  </p>

                                  {insp.findings && (
                                    <p style={{ fontSize: '0.9rem', margin: '6px 0 0 0' }}>
                                      <strong>Findings:</strong> {insp.findings}
                                    </p>
                                  )}
                                  {insp.recommended_action && (
                                    <p style={{ fontSize: '0.9rem', margin: '3px 0 0 0' }}>
                                      <strong>Recommended:</strong> {insp.recommended_action}
                                    </p>
                                  )}
                                  {insp.inspection_notes && (
                                    <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                                      {insp.inspection_notes}
                                    </p>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          ))
        )}
      </div>

      {qrPrintItems.length > 0 && (
        <div className="qr-print-area">
          <h2 className="qr-print-title">NBSC Fire Safety Equipment — QR Labels</h2>
          <div className="qr-print-grid">
            {qrPrintItems.map((item) => (
              <QrLabel key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App