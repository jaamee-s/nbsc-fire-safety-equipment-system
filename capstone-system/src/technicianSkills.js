/* =====================================================================
   technicianSkills.js — what kind of work each technician handles
   (migration 024), and whether a technician fits a piece of equipment.
   ===================================================================== */

export const SPECIALTIES = [
  { key: 'electrical', label: 'Electrical', hint: 'Fire alarms, emergency lights, smoke detectors' },
  { key: 'extinguisher', label: 'Extinguisher', hint: 'Fire extinguisher refill / replacement' },
  { key: 'sprinkler', label: 'Sprinkler / plumbing', hint: 'Sprinklers and water lines' },
  { key: 'general', label: 'General repairs', hint: 'Any equipment' }
]

export const specialtyLabel = (key) => SPECIALTIES.find((s) => s.key === key)?.label || key

// The specialty a job on this equipment type calls for.
export function neededSpecialty(equipmentType) {
  if (equipmentType === 'fire_extinguisher') return 'extinguisher'
  if (['fire_alarm', 'emergency_light', 'smoke_detector'].includes(equipmentType)) return 'electrical'
  if (equipmentType === 'sprinkler') return 'sprinkler'
  return 'general'
}

// true: handles this kind of work. false: has specialties, but not this.
// null: no specialties set yet (nothing to compare).
export function fitsJob(technician, equipmentType) {
  const list = technician?.specialties || []
  if (list.length === 0) return null
  return list.includes('general') || list.includes(neededSpecialty(equipmentType))
}
