import type { IRenderView, VisionFrame } from '../../render/api'
import { defineMessages, t } from '../../core/i18n'
import { detectColor, type ColorDetection } from './detectColor'
import { validVisionProfile, type VisionProfile } from './profile'

type PlcWrite = readonly [string, number | boolean]
export interface VisionInspection {
  frame: VisionFrame
  target: ColorDetection | null
  planePoint: { x: number; z: number } | null
}

const M = defineMessages('visionInspection', {
  unavailable: 'Virtual camera capture is unavailable in this view.',
  invalid: 'Check the camera, detection and PLC mapping settings.',
  projection: 'The target could not be projected onto the configured workpiece plane.',
  triggerInvalid: 'The request must name an unforced BOOL output of the local PLC.',
})

export async function inspectVision(view: IRenderView, profile: VisionProfile): Promise<VisionInspection> {
  if (!view.captureVisionFrame) throw new Error(t(M.unavailable))
  if (!validVisionProfile(profile)) throw new Error(t(M.invalid))
  const frame = await view.captureVisionFrame(profile.camera)
  const color = profile.color
  const target = detectColor(frame.rgba, frame.width, frame.height,
    [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)],
    profile.tolerance, profile.minArea)
  return {
    frame, target,
    planePoint: target && profile.planeY !== null ? frame.projectToPlane(target.centerX, target.centerY, profile.planeY) : null,
  }
}

export function visionWrites(profile: VisionProfile, inspection: VisionInspection | null, automatic: boolean, fault = false): PlcWrite[] {
  const { mapping, plcMode, planeY } = profile
  const target = inspection?.target
  const plane = plcMode === 'plane'
  const x = plane ? inspection?.planePoint?.x : target?.centerX
  const y = plane ? inspection?.planePoint?.z : target?.centerY
  if (!fault && plane && (planeY === null || (target && (x === undefined || y === undefined)))) {
    throw new Error(t(M.projection))
  }
  const writes: PlcWrite[] = [[mapping.found, !fault && Boolean(target)], [mapping.centerX, fault ? 0 : x ?? 0], [mapping.centerY, fault ? 0 : y ?? 0]]
  if (automatic) writes.push([mapping.done, true], [mapping.fault, fault])
  return writes
}

interface VisionLink {
  epoch(): object | null
  isPaused(): boolean
  read(key: string, epoch: object): boolean | null
  write(values: PlcWrite[], epoch: object): string | null
}

/**
 * Request is held high by the PLC until Done. Done is held until Request falls.
 * This remains reliable when the view observes the PLC's sampled watch image.
 */
export function visionHandshake(
  link: VisionLink,
  profile: VisionProfile,
  capture: () => Promise<VisionInspection>,
  publish: (inspection: VisionInspection | null, error: string | null) => void,
): { poll(): Promise<void>; stop(): void } {
  let live = true
  let current: object | null = null
  let latched = false
  let inFlight = false
  let invalidYet = false
  const map = profile.mapping

  async function poll(): Promise<void> {
    const epoch = link.epoch()
    if (current !== epoch) {
      current = epoch
      latched = false
      invalidYet = false
    }
    if (!live || epoch === null || inFlight || link.isPaused()) return
    const request = link.read(map.request, epoch)
    if (request === null) {
      if (!invalidYet) publish(null, t(M.triggerInvalid))
      invalidYet = true
      return
    }
    invalidYet = false
    if (!request) {
      if (latched && link.write([[map.done, false], [map.fault, false]], epoch) === null) latched = false
      return
    }
    if (latched) return
    inFlight = true
    let inspection: VisionInspection | null = null
    let failure: string | null = null
    let writes: PlcWrite[]
    try {
      inspection = await capture()
      writes = visionWrites(profile, inspection, true)
    } catch (reason) {
      failure = reason instanceof Error ? reason.message : String(reason)
      writes = visionWrites(profile, null, true, true)
    } finally {
      inFlight = false
    }
    if (!live || link.epoch() !== epoch || link.isPaused() || link.read(map.request, epoch) !== true) return
    latched = true
    publish(inspection, link.write(writes, epoch) ?? failure)
  }

  return { poll, stop: () => { live = false } }
}
