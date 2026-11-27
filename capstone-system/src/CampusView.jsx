/* =====================================================================
   CampusView.jsx — the campus overview at the top of the Buildings page
   (version B)

   One tile per building, coloured by its worst open problem; picking a
   tile lists its floors with every unit in service and its status.
   Rooms are still added and edited in the Buildings table below.
   ===================================================================== */
import { useState } from 'react'

// Worst first. Each unit and each building gets one of these.
const LEVELS = {
  critical: { rank: 5, label: 'Critical', color: 'var(--red)', bg: 'var(--red-bg)' },
  high: { rank: 4, label: 'High priority', color: 'var(--orange)', bg: 'var(--orange-bg)' },
  defective: { rank: 3, label: 'Defective', color: 'var(--red)', bg: 'var(--red-bg)' },
  minor: { rank: 2, label: 'Medium / low priority', color: 'var(--amber)', bg: 'var(--amber-bg)' },
  expiring: { rank: 1, label: 'Expiring in 30 days', color: 'var(--amber)', bg: 'var(--amber-bg)' },
  ok: { rank: 0, label: 'All functional', color: 'var(--green)', bg: 'var(--green-bg)' }
}

function unitLevel(unit, actionFor, expiringIds) {
  const a = actionFor[unit.id]
  if (a) {
    if (a.priority === 'critical') return 'critical'
    if (a.priority === 'high') return 'high'
    return 'minor'
  }
  if (unit.current_status !== 'functional') return 'defective'
  if (expiringIds.has(unit.id)) return 'expiring'
  return 'ok'
}

const worst = (levels) =>
  levels.reduce((w, l) => (LEVELS[l].rank > LEVELS[w].rank ? l : w), 'ok')

export default function CampusView({
  buildings = [],
  buildingLocations = [],
  equipment = [],
  actions = [],
  expiring = [],
  onManageRooms,
  onViewEquipment
}) {
  const [picked, setPicked] = useState(null)

  // The most urgent open Priority Action of each unit (actions come sorted).
  const actionFor = {}
  actions.forEach((a) => {
    const id = a.equipment?.id
    if (id && !actionFor[id]) actionFor[id] = a
  })
  const expiringIds = new Set(expiring.map((e) => e.id))

  const tiles = buildings.map((b) => {
    const units = equipment
      .filter((e) => e.building_id === b.id && e.current_status !== 'no_longer_in_service')
      .map((e) => ({ ...e, level: unitLevel(e, actionFor, expiringIds) }))
    const floors = [...new Set(buildingLocations.filter((l) => l.building_id === b.id).map((l) => l.floor_label))]
    const problems = units.filter((u) => u.level !== 'ok').length
    return { b, units, floors, problems, level: units.length ? worst(units.map((u) => u.level)) : null }
  })

  const selected = tiles.find((t) => t.b.id === picked) || tiles.find((t) => t.problems > 0) || tiles[0]

  if (buildings.length === 0) return null

  // Units of the selected building grouped by floor ("1st Floor - Rm105 ..."
  // belongs to "1st Floor"); anything else goes under Other locations.
  const floorGroups = selected
    ? [
        ...selected.floors.map((f) => ({
          name: f,
          units: selected.units.filter((u) => (u.exact_location || '').startsWith(`${f} - `) || u.exact_location === f)
        })),
        {
          name: 'Other locations',
          units: selected.units.filter(
            (u) => !selected.floors.some((f) => (u.exact_location || '').startsWith(`${f} - `) || u.exact_location === f)
          )
        }
      ].filter((g) => g.units.length > 0 || g.name !== 'Other locations')
    : []

  return (
    <section className="campus" aria-label="Campus overview">
      <div className="campus-head">
        <div>
          <h2>Campus overview</h2>
          <p>Each building shows its worst open problem. Pick a building to see its floors and units.</p>
        </div>
        <div className="campus-legend">
          {['ok', 'expiring', 'minor', 'high', 'critical'].map((k) => (
            <span key={k}>
              <i style={{ background: LEVELS[k].color }} />
              {LEVELS[k].label}
            </span>
          ))}
        </div>
      </div>

      <div className="campus-body">
        <div className="campus-map">
          {tiles.map((t) => {
            const lv = t.level ? LEVELS[t.level] : null
            const isSel = selected && selected.b.id === t.b.id
            return (
              <button
                key={t.b.id}
                className={`campus-tile ${isSel ? 'selected' : ''}`}
                style={{ borderColor: lv ? lv.color : 'var(--border)' }}
                onClick={() => setPicked(t.b.id)}
                aria-pressed={isSel}
              >
                <span className="campus-tile-top">
                  <strong>{t.b.building_name}</strong>
                  {lv ? (
                    <span className="campus-pill" style={{ background: lv.bg, color: lv.color }}>
                      {t.problems === 0 ? 'All OK' : `${t.problems} to check`}
                    </span>
                  ) : (
                    <span className="campus-pill">No equipment</span>
                  )}
                </span>
                <span className="campus-tile-sub">
                  {t.floors.length} floor{t.floors.length === 1 ? '' : 's'} · {t.units.length} unit
                  {t.units.length === 1 ? '' : 's'}
                </span>
                {t.b.location_description && <span className="campus-tile-sub">{t.b.location_description}</span>}
              </button>
            )
          })}
        </div>

        {selected && (
          <aside className="campus-panel" aria-labelledby="campus-panel-title">
            <div>
              <div className="campus-eyebrow">Building</div>
              <h3 id="campus-panel-title">{selected.b.building_name}</h3>
              <div className="campus-tile-sub">
                {selected.units.length} unit{selected.units.length === 1 ? '' : 's'} in service ·{' '}
                {selected.problems === 0 ? 'all functional' : `${selected.problems} need a look`}
              </div>
            </div>

            {selected.units.length === 0 ? (
              <p className="campus-tile-sub">No equipment in this building yet.</p>
            ) : (
              floorGroups.map((g) => {
                const gl = g.units.length ? LEVELS[worst(g.units.map((u) => u.level))] : null
                return (
                  <div
                    key={g.name}
                    className="campus-floor"
                    style={{ borderColor: gl && gl.rank > 0 ? gl.color : 'var(--border)' }}
                  >
                    <div className="campus-floor-head">
                      <span>{g.name}</span>
                      <span className="campus-tile-sub">
                        {g.units.length} unit{g.units.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {g.units.length > 0 && (
                      <div className="campus-chips">
                        {g.units.map((u) => (
                          <span
                            key={u.id}
                            className="campus-pill"
                            style={{ background: LEVELS[u.level].bg, color: LEVELS[u.level].color }}
                            title={`${u.exact_location || ''} · ${LEVELS[u.level].label}`}
                          >
                            {u.equipment_code}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            <div className="campus-actions">
              <button className="btn btn-primary btn-sm" onClick={() => onManageRooms(selected.b)}>
                Floors &amp; rooms
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onViewEquipment(selected.b)}>
                View equipment
              </button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
