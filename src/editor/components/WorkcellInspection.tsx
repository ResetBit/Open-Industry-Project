import { useState } from 'react'
import { checkSelectedClearance } from '../../core/geometry/selectedClearance'
import { defineMessages, t } from '../../core/i18n'
import { partDisplayNames } from '../../core/parts/partDisplayName'
import type { EditorController } from '../controller'
import { localizePartDisplayName } from '../parts/partMetadata'
import type { EditorState, EditorStore } from '../store/store'
import './WorkcellInspection.css'

const M = defineMessages('workcellInspection', {
  title: 'Equipment clearance and interference',
  summary: 'Choose two pieces of equipment to inspect. A running or paused simulation checks the current collision bodies. A stopped scene uses the equipment’s collision bounds.',
  choose: 'Select equipment…',
  first: 'First part',
  second: 'Second part',
  useSelection: 'Use two selected parts',
  check: 'Inspect pair',
  checking: 'Inspecting…',
  focus: 'Locate parts in the scene',
  noResult: 'No inspection result for this pair yet.',
  unavailable: 'No collision geometry is available for the selected pair.',
  clearance: 'Gap between collision bounds: {distance} mm.',
  possible: 'Potential overlap of collision bounds near ({x}, {y}, {z}) m.',
  overlap: 'Interference at {seconds} s near ({x}, {y}, {z}) m. Penetration: {depth} mm.',
  clear: 'No interference at {seconds} s.',
  job: 'Robot job step: {part} · row {row}.',
  gapLimit: 'Bounds are for screening. Inspect the running simulation to confirm.',
  frameLimit: 'This is one sample. Pause and advance step by step to inspect a movement.',
})

function eligible(part: EditorState['scene']['parts'][number]): boolean {
  return part.type !== 'building' && part.type !== 'group' && part.type !== 'annotation'
}

export function WorkcellInspection({ store, state, controller }: {
  store: EditorStore
  state: EditorState
  controller: EditorController | null
}) {
  const parts = state.scene.parts.filter(eligible)
  const names = partDisplayNames(state.scene.parts)
  const shownName = (part: (typeof parts)[number]): string => localizePartDisplayName(part, names.get(part.id) ?? part.id)
  const selected = state.selectedIds.filter((id) => parts.some((part) => part.id === id))
  const [first, setFirst] = useState(selected[0] ?? '')
  const [second, setSecond] = useState(selected[1] ?? '')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{
    scene: EditorState['scene']
    run: number | undefined
    running: boolean
    first: string
    second: string
    text: string
    warnings: readonly string[]
    overlap: boolean
  } | null>(null)

  const firstPart = parts.find((part) => part.id === first)
  const secondPart = parts.find((part) => part.id === second)
  const enabled = firstPart !== undefined && secondPart !== undefined && first !== second
  const shown = result?.scene === state.scene && result.run === controller?.runSerial && result.running === state.running
    && result.first === first && result.second === second ? result : null

  const inspect = async (): Promise<void> => {
    if (!firstPart || !secondPart || first === second) return
    const record = { scene: state.scene, run: controller?.runSerial, running: state.running, first, second }
    if (!state.running) {
      const hit = checkSelectedClearance(firstPart, secondPart)
      const text = hit.kind === 'overlap' ? t(M.possible, coordinates(hit.point))
        : hit.kind === 'clearance' ? t(M.clearance, { distance: (hit.metres * 1000).toFixed(1) }) : t(M.unavailable)
      setResult({ ...record, text, warnings: hit.kind === 'unavailable' ? [] : [t(M.gapLimit)], overlap: hit.kind === 'overlap' })
      return
    }
    setPending(true)
    try {
      const detail = await controller?.sim.inspectPartInterference(first, second)
      if (controller?.runSerial !== record.run || !store.getState().running) return
      if (!detail || detail.result.kind === 'unavailable') {
        setResult({ ...record, text: t(M.unavailable), warnings: [], overlap: false })
        return
      }
      const seconds = detail.simTime.toFixed(3)
      const hit = detail.result
      const text = hit.kind === 'overlap'
        ? t(M.overlap, { seconds, ...coordinates(hit.point), depth: (hit.penetrationMetres * 1000).toFixed(2) })
        : t(M.clear, { seconds })
      const steps = [firstPart, secondPart].flatMap((part) => {
        const row = detail.jobRows?.[part.id]
        return typeof row === 'number' && row >= 0 ? [t(M.job, { part: shownName(part), row: row + 1 })] : []
      })
      setResult({ ...record, text, warnings: [...steps, t(M.frameLimit)], overlap: hit.kind === 'overlap' })
    } catch (error) {
      console.warn('[oip] inspecting the equipment pair failed', error)
      setResult({ ...record, text: t(M.unavailable), warnings: [], overlap: false })
    } finally {
      setPending(false)
    }
  }

  const equipmentSelect = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="workcell-inspection-part">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t(M.choose)}</option>
        {parts.map((part) => <option key={part.id} value={part.id}>{shownName(part)}</option>)}
      </select>
    </label>
  )

  return (
    <section className="workcell-inspection" data-testid="workcell-inspection">
      <h3>{t(M.title)}</h3>
      <p>{t(M.summary)}</p>
      <div className="workcell-inspection-pair">
        {equipmentSelect(t(M.first), first, setFirst)}
        {equipmentSelect(t(M.second), second, setSecond)}
      </div>
      <div className="workcell-inspection-actions">
        <button className="props-ok" type="button" disabled={selected.length !== 2} onClick={() => {
          setFirst(selected[0]!)
          setSecond(selected[1]!)
        }}>{t(M.useSelection)}</button>
        <button className="props-ok" type="button" disabled={!enabled || pending} onClick={() => void inspect()}>{t(pending ? M.checking : M.check)}</button>
        <button className="props-ok" type="button" disabled={!enabled || !controller} onClick={() => {
          store.selectMany([first, second])
          controller?.view.focusOn([first, second])
        }}>{t(M.focus)}</button>
      </div>
      <div className={shown?.overlap ? 'ctl-problem' : 'ctl-dim'} role="status" data-testid="workcell-inspection-result">
        {shown?.text ?? t(M.noResult)}
        {shown?.warnings.map((warning) => <div key={warning}>{warning}</div>)}
      </div>
    </section>
  )
}

function coordinates([x, y, z]: readonly [number, number, number]): { x: string; y: string; z: string } {
  return { x: x.toFixed(3), y: y.toFixed(3), z: z.toFixed(3) }
}

