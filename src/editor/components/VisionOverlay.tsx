import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { defineMessages, t } from '../../core/i18n'
import type { IRenderView } from '../../render/api'
import type { EditorController } from '../controller'
import { currentDocumentId, onCurrentDocumentChange } from '../project/documentStore'
import { cameraFromView, defaultVisionProfile, loadVisionProfile, resetVisionProfile, saveVisionProfile, type VisionProfile } from '../vision/profile'
import { inspectVision, visionHandshake, visionWrites, type VisionInspection } from '../vision/inspection'
import { trapTab, useFocusHandoff, useModalKeys } from './inspector/menu'
import './VisionOverlay.css'

const M = defineMessages('visionOverlay', {
  title: 'Virtual vision station',
  close: 'Close',
  cameraPosition: 'Camera position (m)',
  aimPoint: 'Aim point (m)',
  fov: 'Field of view (°)',
  light: 'Fill light intensity',
  resolution: 'Resolution',
  targetColor: 'Target colour',
  tolerance: 'Colour tolerance',
  minArea: 'Minimum region (pixels)',
  workPlane: 'Workpiece plane Y (m)',
  useCurrent: 'Use current view',
  capture: 'Capture and detect',
  capturing: 'Capturing…',
  image: 'Captured virtual camera image',
  detected: 'Target found at ({x}, {y}) px · {area} pixels',
  noTarget: 'No matching target detected',
  plane: 'World X/Z ({x}, {z}) m',
  planeUnavailable: 'The target is outside the selected workpiece plane.',
  plcMode: 'PLC coordinate format',
  pixelMode: 'Image X/Y (px)',
  planeMode: 'World X/Z (m)',
  found: 'Detected · PLC BOOL input',
  coordinateX: 'X position · PLC REAL input',
  coordinateY: 'Y or Z position · PLC REAL input',
  request: 'Acquisition request · PLC BOOL output',
  done: 'Acquisition complete · PLC BOOL input',
  fault: 'Acquisition fault · PLC BOOL input',
  automatic: 'Capture on PLC request',
  automaticHelp: 'The PLC holds the request high until completion, then clears it to arm the next inspection. This also runs with the panel closed.',
  automaticActive: 'The local vision station is waiting for PLC requests. Stop the simulation to edit the settings.',
  write: 'Write detection to local PLC',
  stale: 'Acquire a new image during the current local PLC run.',
  queued: 'Detection sent to the local PLC.',
  profileDescription: 'Save these camera, detection and PLC settings on this device.',
  profileNeedsProject: 'Save the project before saving its vision settings.',
  saveProfile: 'Save vision settings',
  resetProfile: 'Restore defaults',
  profileSaved: 'Vision settings saved for this project.',
  profileReset: 'Default settings restored.',
  profileReadError: 'Could not load saved vision settings. Defaults are shown.',
  profileSaveError: 'Could not save vision settings to this device.',
  profileResetError: 'Could not remove saved vision settings.',
  profileInvalid: 'Check the camera and detection settings before saving.',
})

interface VisionOverlayProps {
  view: IRenderView
  controller: EditorController | null
  open: boolean
  onClose: () => void
}

const emptySubscribe = () => () => {}
const initialScene = () => 0

export function VisionOverlay(props: VisionOverlayProps) {
  const id = useSyncExternalStore(onCurrentDocumentChange, currentDocumentId)
  const sceneLoads = useSyncExternalStore(props.controller?.store.subscribe ?? emptySubscribe,
    () => props.controller?.store.sceneLoads ?? 0, initialScene)
  return <VisionStation key={JSON.stringify([id, sceneLoads])} {...props} documentId={id} />
}

interface CaptureResult {
  inspection: VisionInspection
  epoch: object | null
  profile: VisionProfile
}

function VisionStation({ view, controller, open, onClose, documentId }: VisionOverlayProps & { documentId: string | null }) {
  const defaults = () => defaultVisionProfile(view, controller?.store.getState().scene)
  const [initial] = useState(() => {
    try {
      return { profile: (documentId ? loadVisionProfile(documentId) : null) ?? defaults(), failed: false }
    } catch {
      return { profile: defaults(), failed: true }
    }
  })
  const [profile, setProfile] = useState(initial.profile)
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    () => initial.failed ? { text: t(M.profileReadError), error: true } : null,
  )
  const [busy, setBusy] = useState(false)
  const captureBusy = useRef(false)
  const running = useSyncExternalStore(controller?.store.subscribe ?? emptySubscribe,
    () => controller?.store.getState().running ?? false)
  const auto = running && profile.automatic

  useEffect(() => {
    if (!controller || !auto) return
    const handshake = visionHandshake({
      epoch: () => controller.visionRunEpoch,
      isPaused: () => controller.store.getState().paused,
      read: (key, epoch) => controller.readVisionRequest(key, epoch),
      write: (values, epoch) => controller.writeVisionInputs(values, epoch),
    }, profile, () => inspectVision(view, profile), (inspection, error) => {
      setResult(inspection ? { inspection, epoch: controller.visionRunEpoch, profile } : null)
      setStatus({ text: error ?? t(M.queued), error: error !== null })
    })
    const timer = window.setInterval(() => {
      if (!captureBusy.current) void handshake.poll()
    }, 100)
    return () => {
      handshake.stop()
      clearInterval(timer)
    }
  }, [controller, view, profile, auto])

  function edit(update: Partial<VisionProfile>) {
    setProfile((previous) => ({ ...previous, ...update }))
    setResult(null)
    setStatus(null)
  }

  async function capture() {
    if (captureBusy.current || auto) return
    captureBusy.current = true
    const epoch = controller?.visionRunEpoch ?? null
    setBusy(true)
    setResult(null)
    setStatus(null)
    try {
      setResult({ inspection: await inspectVision(view, profile), epoch, profile })
    } catch (reason) {
      setStatus({ error: true, text: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      captureBusy.current = false
      setBusy(false)
    }
  }

  function write() {
    if (!controller || !result || result.epoch === null || result.profile !== profile || controller.visionRunEpoch !== result.epoch) {
      setStatus({ error: true, text: t(M.stale) })
      return
    }
    try {
      const error = controller.writeVisionInputs(visionWrites(profile, result.inspection, false), result.epoch)
      setStatus({ error: error !== null, text: error ?? t(M.queued) })
    } catch (reason) {
      setStatus({ error: true, text: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  function save() {
    if (!documentId || documentId !== currentDocumentId()) return
    try {
      const saved = saveVisionProfile(documentId, profile)
      setStatus({ error: !saved, text: t(saved ? M.profileSaved : M.profileInvalid) })
    } catch {
      setStatus({ error: true, text: t(M.profileSaveError) })
    }
  }

  function reset() {
    if (documentId && documentId !== currentDocumentId()) return
    try {
      if (documentId) resetVisionProfile(documentId)
      edit(defaults())
      setStatus({ error: false, text: t(M.profileReset) })
    } catch {
      setStatus({ error: true, text: t(M.profileResetError) })
    }
  }

  return open && <VisionDialog onClose={onClose} profile={profile} edit={edit} busy={busy} capture={() => void capture()}
    result={result?.inspection ?? null} status={status} canCapture={Boolean(view.captureVisionFrame)}
    auto={auto} write={write} save={save} reset={reset} maySave={documentId !== null}
    useCurrent={() => {
      const pose = cameraFromView(view)
      edit({ camera: { ...profile.camera, position: pose.position, target: pose.target } })
    }} />
}

function VisionDialog({ onClose, profile, edit, busy, capture, result, status, canCapture, auto, write, save, reset, maySave, useCurrent }: {
  onClose: () => void
  profile: VisionProfile
  edit: (update: Partial<VisionProfile>) => void
  busy: boolean
  capture: () => void
  result: VisionInspection | null
  status: { text: string; error: boolean } | null
  canCapture: boolean
  auto: boolean
  write: () => void
  save: () => void
  reset: () => void
  maySave: boolean
  useCurrent: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLCanvasElement>(null)
  useModalKeys(onClose, (event) => { if (dialog.current) trapTab(dialog.current, event) })
  useFocusHandoff(() => dialog.current?.querySelector('button')?.focus())

  useEffect(() => {
    const context = image.current?.getContext('2d')
    if (!context || !result) return
    const { frame, target } = result
    const pixels = context.createImageData(frame.width, frame.height)
    pixels.data.set(frame.rgba)
    context.putImageData(pixels, 0, 0)
    if (target) {
      context.strokeStyle = '#00ff92'
      context.lineWidth = 2
      context.strokeRect(target.x, target.y, target.width, target.height)
      context.beginPath()
      context.moveTo(target.centerX - 4, target.centerY)
      context.lineTo(target.centerX + 4, target.centerY)
      context.moveTo(target.centerX, target.centerY - 4)
      context.lineTo(target.centerX, target.centerY + 4)
      context.stroke()
    }
  }, [result])

  const { camera, mapping } = profile
  const locked = auto || busy
  const numberInput = (caption: string, value: number, min: number, max: number, step: string, change: (value: number) => void) =>
    <label>{caption}
      <input type="number" required min={min} max={max} step={step} value={Number.isNaN(value) ? '' : value}
        onChange={(event) => change(event.target.valueAsNumber)} />
    </label>

  return <div className="author-backdrop" onPointerDown={onClose}>
    <div className="author-dialog vision-dialog" ref={dialog} role="dialog" aria-modal="true"
      aria-label={t(M.title)} data-testid="vision-overlay" onPointerDown={(event) => event.stopPropagation()}>
      <div className="author-head"><h2>{t(M.title)}</h2>
        <button type="button" className="author-close" aria-label={t(M.close)} onClick={onClose}>×</button></div>
      <form onSubmit={(event) => { event.preventDefault(); capture() }}>
        <fieldset className="vision-fields" disabled={locked}>
          {(['position', 'target'] as const).map((field) =>
            <fieldset key={field}>
              <legend>{t(field === 'position' ? M.cameraPosition : M.aimPoint)}</legend>
              <div className="vision-axes">{(['X', 'Y', 'Z'] as const).map((axis, i) =>
                <label key={axis}>{axis}
                  <input type="number" step="any" required value={Number.isNaN(camera[field][i]) ? '' : camera[field][i]}
                    onChange={(event) => {
                      const vector = [...camera[field]] as [number, number, number]
                      vector[i] = event.target.valueAsNumber
                      edit({ camera: { ...camera, [field]: vector } })
                    }} /></label>)}</div>
            </fieldset>)}
          {numberInput(t(M.fov), camera.fov, 10, 120, 'any', (fov) => edit({ camera: { ...camera, fov } }))}
          {numberInput(t(M.light), camera.lightIntensity, 0, 100, 'any', (lightIntensity) => edit({ camera: { ...camera, lightIntensity } }))}
          <label>{t(M.resolution)}
            <select value={camera.width} onChange={(event) => {
              const width = Number(event.target.value)
              edit({ camera: { ...camera, width, height: width * 3 / 4 } })
            }}><option value={320}>320 × 240</option><option value={640}>640 × 480</option></select>
          </label>
          <label>{t(M.targetColor)}<input type="color" value={profile.color} onChange={(event) => edit({ color: event.target.value })} /></label>
          {numberInput(t(M.tolerance), profile.tolerance, 0, 200, '1', (tolerance) => edit({ tolerance }))}
          {numberInput(t(M.minArea), profile.minArea, 1, camera.width * camera.height, '1', (minArea) => edit({ minArea }))}
          <label>{t(M.workPlane)}
            <input type="number" step="any" value={profile.planeY ?? ''} data-testid="vision-plane-y"
              onChange={(event) => {
                const value = event.target.valueAsNumber
                edit({ planeY: Number.isNaN(value) ? null : value })
              }} />
          </label>
        </fieldset>
        <div className="props-foot">
          <button type="button" className="props-ok" disabled={locked} onClick={useCurrent}>{t(M.useCurrent)}</button>
          <button type="submit" className="props-ok" disabled={locked || !canCapture} data-testid="vision-capture">
            {t(busy ? M.capturing : M.capture)}
          </button>
        </div>
      </form>
      {result && <>
        <canvas ref={image} width={result.frame.width} height={result.frame.height} aria-label={t(M.image)} data-testid="vision-image" />
        <p className="vision-result" role="status" data-testid="vision-result">{result.target
          ? t(M.detected, { x: result.target.centerX.toFixed(1), y: result.target.centerY.toFixed(1), area: result.target.area })
          : t(M.noTarget)}</p>
        {result.target && profile.planeY !== null && <p className="vision-result">{result.planePoint
          ? t(M.plane, { x: result.planePoint.x.toFixed(3), z: result.planePoint.z.toFixed(3) })
          : t(M.planeUnavailable)}</p>}
      </>}
      <fieldset className="vision-fields" disabled={locked}>
        <label>{t(M.plcMode)}
          <select value={profile.plcMode} onChange={(event) => edit({ plcMode: event.target.value === 'plane' ? 'plane' : 'pixel' })}>
            <option value="pixel">{t(M.pixelMode)}</option><option value="plane">{t(M.planeMode)}</option>
          </select>
        </label>
        {([
          ['found', M.found], ['centerX', M.coordinateX], ['centerY', M.coordinateY],
          ...(profile.automatic ? [['request', M.request], ['done', M.done], ['fault', M.fault]] as const : []),
        ] as const).map(([key, caption]) => <label key={key}>{t(caption)}
          <input type="text" maxLength={160} autoComplete="off" value={mapping[key]}
            onChange={(event) => edit({ mapping: { ...mapping, [key]: event.target.value } })} />
        </label>)}
        <label>{t(M.automatic)}
          <input type="checkbox" checked={profile.automatic} onChange={(event) => edit({ automatic: event.target.checked })} />
        </label>
      </fieldset>
      <p className="vision-result">{t(auto ? M.automaticActive : M.automaticHelp)}</p>
      <div className="props-foot">
        <button type="button" className="props-ok" disabled={locked || !result} onClick={write}>{t(M.write)}</button>
      </div>
      <section className="vision-plc">
        <p className="author-intro">{t(maySave ? M.profileDescription : M.profileNeedsProject)}</p>
        <div className="props-foot">
          <button type="button" className="props-ok" disabled={!maySave || locked} onClick={save}>{t(M.saveProfile)}</button>
          <button type="button" className="props-ok" disabled={locked} onClick={reset}>{t(M.resetProfile)}</button>
        </div>
        {status && <p className="vision-result" role={status.error ? 'alert' : 'status'} data-testid="vision-status">{status.text}</p>}
      </section>
    </div>
  </div>
}

