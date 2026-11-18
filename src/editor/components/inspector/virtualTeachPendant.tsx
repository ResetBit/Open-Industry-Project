import { useEffect, useId, useState, type ReactNode } from 'react'
import { defineMessages, t } from '../../../core/i18n'
import { quatToYXZ } from '../../../core/math'
import { robotUnit } from '../../../core/robot/robotController'
import type { PartInstance, SdkPart } from '../../../core/types'
import type { EditorController } from '../../controller'
import type { EditorStore } from '../../store/store'
import { captureWaypoint, jogCartesian, jogJoint, readTcp, tcpPose, teachModel, teachingDocument, validateTeaching, type TeachFrame, type TeachModel } from './teachModel'
import { getPackage } from '../../../core/parts/partRegistry'
import './virtualTeachPendant.css'

const M = defineMessages('inspector.pendant', {
  title: 'Virtual teach pendant',
  close: 'Close teach pendant',
  jog: 'Jog',
  points: 'Waypoints',
  program: 'Program and debug',
  position: 'TCP position (mm)',
  orientation: 'TCP orientation (° · YXZ)',
  base: 'Robot base',
  world: 'World',
  tool: 'Tool',
  workpiece: 'Workpiece',
  frame: 'Coordinate frame',
  mark: 'Workpiece coordinate origin',
  choose: 'Choose a scene part',
  step: 'Step (° / mm)',
  joint: 'Joint',
  cartesian: 'Cartesian jog',
  lower: 'Move {axis} negative',
  higher: 'Move {axis} positive',
  reset: 'Restore saved pose',
  unavailable: 'The robot pose is not available.',
  unreachable: 'This position could not be reached at the current tool orientation.',
  poseHeld: 'Jogging previews a pose. Capture a waypoint to keep it.',
  pointName: 'Waypoint name',
  pointNameRequired: 'Enter a name for the waypoint.',
  capture: 'Capture new waypoint',
  replace: 'Update selected waypoint',
  selectPoint: 'Select waypoint',
  pointLabel: 'Waypoint {number}',
  goTo: 'Preview selected waypoint',
  pointSaved: 'Waypoint captured.',
  updateSaved: 'Waypoint updated.',
  check: 'Check teaching data',
  passed: 'Waypoint limits and job references passed.',
  pointData: 'Waypoint {point} has invalid joint values.',
  pointLimit: 'Waypoint {point} exceeds the limit of {joint}.',
  jobData: 'Job row {step} has an invalid operation or argument.',
  jobPoint: 'Job row {step} points to a missing waypoint.',
  motion: 'Motion speed and acceleration must be positive.',
  exportData: 'Export teaching data (.json)',
  exportHelp: 'The JSON contains simulation waypoints, robot jobs and signal bindings.',
  runHint: 'Start a simulation from the Simulation toolbar to see the active job step.',
  preview: 'Joint-space preview between waypoints',
  previewFrom: 'From waypoint',
  previewTo: 'To waypoint',
  previewProgress: 'Preview progress',
  pause: 'Pause simulation',
  resume: 'Resume simulation',
  advance: 'Advance one simulation tick',
  stop: 'Stop simulation',
  disabled: 'This robot is locked or the project is read-only.',
})

const FRAMES = ['base', 'world', 'tool', 'workpiece'] as const
const STEPS = [1, 5, 10, 25] as const
const AXES = ['X', 'Y', 'Z'] as const
type Section = 'jog' | 'points' | 'program'

interface Props {
  part: SdkPart
  model: TeachModel
  controller: EditorController | null
  store: EditorStore
  parts: readonly PartInstance[]
  running: boolean
  paused: boolean
  readOnly: boolean
  waypointEditor: ReactNode
  programEditor: ReactNode
  onClose: () => void
}

export function VirtualTeachPendant({ part, model, controller, store, parts, running, paused, readOnly, waypointEditor, programEditor, onClose }: Props) {
  const heading = useId()
  const [section, setSection] = useState<Section>('jog')
  const [frame, setFrame] = useState<TeachFrame>('base')
  const [originId, setOriginId] = useState('')
  const [step, setStep] = useState<number>(5)
  const [name, setName] = useState('')
  const [selection, setSelection] = useState('')
  const [from, setFrom] = useState('0')
  const [to, setTo] = useState('1')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [checked, setChecked] = useState(false)
  const [row, setRow] = useState<number[] | null>(null)
  const workpiece = frame === 'workpiece' ? parts.find((item) => item.id === originId && item.id !== part.id) : undefined
  const selected = selection === '' ? null : Number(selection)
  const selectedPoint = selected === null ? undefined : model.waypoints[selected]
  const writable = !running && !readOnly && !part.locked && controller !== null

  function canPose(): boolean {
    const current = store.getState()
    const selectedPart = current.scene.parts.find((candidate) => candidate.id === part.id)
    return !!controller && !current.running && !current.readOnly && current.selectedIds.length === 1
      && current.selectedIds[0] === part.id && !!selectedPart && !selectedPart.locked
  }

  function pose(result: number[]): void {
    if (!controller?.view.hasRigGizmo(part.id) || !canPose() || result.length !== model.kin.joints.length || !result.every(Number.isFinite)) {
      setStatus(t(M.unavailable))
      return
    }
    controller.previewRigPose(part.id, result)
    setRow(result)
    setStatus('')
  }

  function currentPose(): number[] | null {
    return controller?.view.hasRigGizmo(part.id) ? controller.captureRigPose(part.id) : null
  }

  function jog(axis: number, direction: -1 | 1, cartesian: boolean): void {
    if (!canPose()) return
    const source = currentPose()
    if (!source) {
      setStatus(t(M.unavailable))
      return
    }
    const result = cartesian
      ? jogCartesian(part, model, source, frame, axis, direction * step / 1000, workpiece)
      : jogJoint(model, source, axis, direction * step)
    if (result) pose(result)
    else setStatus(t(M.unreachable))
  }

  function saveWaypoint(index: number | null): void {
    if (!canPose()) return
    const newRow = currentPose()
    const current = store.getState().scene
    const robot = current.parts.find((candidate) => candidate.id === part.id)
    const latest = robot?.type === 'part' && teachModel(robot, getPackage(robot.packageId))
    if (!latest || !robot || robot.type !== 'part' || !newRow || latest.kin.joints.length !== newRow.length || !newRow.every(Number.isFinite)) {
      setStatus(t(M.unavailable))
      return
    }
    if (!name.trim()) {
      setStatus(t(M.pointNameRequired))
      return
    }
    if (index !== null && !latest.waypoints[index]) {
      setStatus(t(M.unavailable))
      return
    }
    const patch = captureWaypoint(latest, newRow, name, index)
    store.commit(t(index === null ? M.capture : M.replace), {
      ...current,
      parts: current.parts.map((candidate) => candidate.id === robot.id ? { ...robot, params: { ...robot.params, ...patch } } : candidate),
    })
    setSelection(String(index ?? latest.waypoints.length))
    setStatus(t(index === null ? M.pointSaved : M.updateSaved))
  }

  useEffect(() => {
    if (!controller) return
    const sample = (): void => {
      const frameJoints = controller.lastFrame?.joints?.[part.id]
      const values = running ? frameJoints : controller.view.rigJointPose(part.id)
      const current = values ? model.kin.joints.map((joint) => (values[joint.name] ?? 0) * robotUnit(joint.type)) : null
      setRow((previous) => current && previous && current.length === previous.length && current.every((n, i) => Math.abs(n - previous[i]!) < 1e-5) ? previous : current)
    }
    sample()
    const timer = window.setInterval(sample, 200)
    return () => window.clearInterval(timer)
  }, [controller, part.id, running, model.kin.joints])

  const base = row && tcpPose(model, row)
  const displayed = frame === 'workpiece' && !workpiece ? null : base && readTcp(part, base, frame, workpiece)
  const angle = displayed && quatToYXZ(...displayed.quat).map((radians) => radians * 180 / Math.PI)
  const tcpText = (values: readonly number[], scale: number) => values.map((value, i) => `${AXES[i]} ${(value * scale).toFixed(1)}`).join(' · ')
  const issues = section === 'program' ? validateTeaching(model) : []

  function exportData(): void {
    const json = JSON.stringify(teachingDocument(part, model), null, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${part.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.robot-teaching.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const waypointOptions = model.waypoints.map((_, index) => (
    <option key={index} value={index}>{model.waypointNames[index] || t(M.pointLabel, { number: index + 1 })}</option>
  ))

  return (
    <section className="virtual-teach" aria-labelledby={heading} data-testid="virtual-teach-pendant">
      <header className="virtual-teach-header">
        <h3 id={heading}>{t(M.title)}</h3>
        <button type="button" aria-label={t(M.close)} title={t(M.close)} onClick={onClose}>×</button>
      </header>
      <div className="virtual-teach-nav">
        {(['jog', 'points', 'program'] as const).map((value) => (
          <button type="button" key={value} aria-pressed={section === value} onClick={() => { setSection(value); setStatus('') }}>
            {t(M[value])}
          </button>
        ))}
      </div>
      {section === 'jog' && (
        <>
          <label className="virtual-teach-label">
            {t(M.frame)}
            <select className="rig-select" value={frame} onChange={(event) => setFrame(FRAMES.find((item) => item === event.target.value) ?? 'base')}>
              {FRAMES.map((item) => <option key={item} value={item}>{t(M[item])}</option>)}
            </select>
          </label>
          {frame === 'workpiece' && (
            <label className="virtual-teach-label">
              {t(M.mark)}
              <select className="rig-select" value={originId} onChange={(event) => setOriginId(event.target.value)}>
                <option value="">{t(M.choose)}</option>
                {parts.filter((item) => item.id !== part.id).map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
              </select>
            </label>
          )}
          {displayed && angle && (
            <div className="virtual-teach-readout" data-testid="virtual-teach-tcp">
              <span>{t(M.position)} · {t(frame === 'tool' ? M.base : M[frame])}</span>
              <output>{tcpText(displayed.pos, 1000)}</output>
              <span>{t(M.orientation)}</span>
              <output>{tcpText(angle, 1)}</output>
            </div>
          )}
          <fieldset disabled={!writable} className="virtual-teach-field">
            <legend>{t(M.joint)}</legend>
            <label className="virtual-teach-label">
              {t(M.step)}
              <select className="rig-select" value={step} onChange={(event) => setStep(Number(event.target.value))}>
                {STEPS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            {model.kin.joints.map((joint, index) => (
              <div className="virtual-teach-move" key={joint.name}>
                <span>{joint.name}</span>
                {/* i18n-ok: measurement unit */}
                <output>{row?.[index]?.toFixed(1) ?? '–'} {joint.type === 'revolute' ? '°' : 'mm'}</output>
                <button type="button" aria-label={t(M.lower, { axis: joint.name })} onClick={() => jog(index, -1, false)}>−</button>
                <button type="button" aria-label={t(M.higher, { axis: joint.name })} onClick={() => jog(index, 1, false)}>+</button>
              </div>
            ))}
            <button type="button" onClick={() => { if (canPose()) controller?.resetJog(part.id) }}>{t(M.reset)}</button>
          </fieldset>
          <fieldset disabled={!writable || (frame === 'workpiece' && !workpiece)} className="virtual-teach-field">
            <legend>{t(M.cartesian)}</legend>
            {AXES.map((axis, i) => (
              <div className="virtual-teach-move" key={axis}>
                <span>{axis}</span>
                {/* i18n-ok: measurement unit */}
                <output>{step} mm</output>
                <button type="button" aria-label={t(M.lower, { axis })} onClick={() => jog(i, -1, true)}>−</button>
                <button type="button" aria-label={t(M.higher, { axis })} onClick={() => jog(i, 1, true)}>+</button>
              </div>
            ))}
          </fieldset>
          <p className="inspector-hint">{t(readOnly || part.locked ? M.disabled : M.poseHeld)}</p>
        </>
      )}
      {section === 'points' && (
        <>
          <label className="virtual-teach-label">
            {t(M.pointName)}
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="button" disabled={!writable} onClick={() => saveWaypoint(null)}>{t(M.capture)}</button>
          <label className="virtual-teach-label">
            {t(M.selectPoint)}
            <select className="rig-select" value={selectedPoint ? selection : ''} onChange={(event) => {
              const value = event.target.value
              setSelection(value)
              if (value !== '') setName(model.waypointNames[Number(value)] ?? '')
            }}>
              <option value="">{t(M.selectPoint)}</option>
              {waypointOptions}
            </select>
          </label>
          <div className="virtual-teach-actions">
            <button type="button" disabled={!writable || !selectedPoint} onClick={() => { if (selectedPoint) pose(selectedPoint) }}>{t(M.goTo)}</button>
            <button type="button" disabled={!writable || !selectedPoint} onClick={() => saveWaypoint(selected)}>{t(M.replace)}</button>
          </div>
          {waypointEditor}
        </>
      )}
      {section === 'program' && (
        <>
          {!running && <p className="inspector-hint">{t(M.runHint)}</p>}
          {running && controller && (
            <div className="virtual-teach-actions">
              <button type="button" onClick={() => controller.togglePause()}>{t(paused ? M.resume : M.pause)}</button>
              <button type="button" disabled={!paused} onClick={() => controller.step()}>{t(M.advance)}</button>
              <button type="button" onClick={() => controller.stop()}>{t(M.stop)}</button>
            </div>
          )}
          {programEditor}
          <fieldset className="virtual-teach-field" disabled={!writable || model.waypoints.length < 2}>
            <legend>{t(M.preview)}</legend>
            <label className="virtual-teach-label">
              {t(M.previewFrom)}
              <select className="rig-select" value={from} onChange={(event) => { setFrom(event.target.value); setProgress(0) }}>{waypointOptions}</select>
            </label>
            <label className="virtual-teach-label">
              {t(M.previewTo)}
              <select className="rig-select" value={to} onChange={(event) => { setTo(event.target.value); setProgress(0) }}>{waypointOptions}</select>
            </label>
            <input type="range" min={0} max={100} value={progress} aria-label={t(M.previewProgress)} onChange={(event) => {
              const value = Number(event.target.value)
              const first = model.waypoints[Number(from)]
              const end = model.waypoints[Number(to)]
              if (!first || !end || first.length !== end.length) return
              setProgress(value)
              pose(first.map((n, i) => n + (end[i]! - n) * value / 100))
            }} />
          </fieldset>
          <div className="virtual-teach-actions">
            <button type="button" onClick={() => setChecked(true)}>{t(M.check)}</button>
            <button type="button" disabled={issues.length > 0} title={t(M.exportHelp)} onClick={exportData}>{t(M.exportData)}</button>
          </div>
          {checked && (issues.length === 0
            ? <p role="status">{t(M.passed)}</p>
            : <ul className="virtual-teach-errors" role="status">{issues.slice(0, 30).map((issue, index) => (
              <li key={index}>{t(M[issue.kind], { ...issue })}</li>
            ))}</ul>)}
        </>
      )}
      {status && <p className="inspector-hint" role="status">{status}</p>}
    </section>
  )
}
